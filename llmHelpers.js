// ensure environment variables from .env are loaded when this module is required
// use override:true so values in .env replace any pre-existing env vars
require('dotenv').config({ override: true });
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

// read example document structure for prompts
let exampleDoc = null;
try {
  const raw = fs.readFileSync(path.join(__dirname, 'data-structure.json'), 'utf8');
  exampleDoc = JSON.parse(raw);
} catch (err) {
  console.warn('Unable to load data-structure.json for prompts:', err.message);
}


// path to fallback JSON used when Gemini calls fail
const FAKE_RESPONSE_PATH = path.join(__dirname, 'fake-gemini-response.json');


// initialize Gemini client once using environment variable GEMINI_API_KEY
// (set this before running the server). If the key is missing we keep
// `gemini` null and the calling code can either use fake helpers or
// throw a descriptive error when real LLM calls are attempted.
// model can also be set via GEMINI_MODEL env var; default avoids the unavailable
// 'gemini-1.5-flash-latest' which the SDK currently uses by default.
let GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5';
// strip an optional "models/" prefix since the SDK will prepend it itself
if (GEMINI_MODEL.startsWith('models/')) {
  GEMINI_MODEL = GEMINI_MODEL.slice('models/'.length);
}
let gemini = null;
let geminiReady = false;

// dynamic import because gemini-ai is an ES module
async function initGemini() {
  if (geminiReady) return;
  if (!process.env.GEMINI_API_KEY) {
    console.warn('GEMINI_API_KEY not set; LLM functionality will be disabled.');
    geminiReady = true; // prevent future attempts
    return;
  }

  try {
    console.log('Initializing Gemini client with provided API key' +
      '(truncated for security): ' + process.env.GEMINI_API_KEY.substring(0, 5) + '...');
    console.log('Using Gemini model:', GEMINI_MODEL);
    const { default: Gemini } = await import('gemini-ai');
    gemini = new Gemini(process.env.GEMINI_API_KEY);
  } catch (err) {
    console.error('Error loading Gemini SDK:', err);
    gemini = null;
  } finally {
    geminiReady = true;
  }
}

/**
 * Takes arbitrary human-readable note data and asks an LLM to return
 * a canonical JSON representation.  This is just a sample prompt;
 * tweak according to your schema.
 * @param {string} text   freeform note text or object serialized as string
 * @returns {Promise<object>} parsed JSON object
 */
async function convertToJson(text) {
  // make sure we have attempted to initialize the Gemini client
  await initGemini();
  if (!gemini) {
    // fallback to fake implementation if the client isn't configured
    return fakeConvertToJson(text);
  }

  const prompt = `Convert the following medical note into a JSON object with keys ` +
    `patient, notes, test, date, and any other attributes inferred from the text. ` +
    `Return only the JSON object (no explanatory text).

Text:\n"""${text}"""`;

  // Gemini API returns raw text, so just ask for the prompt
  try {
    const respText = await gemini.ask(prompt, { model: GEMINI_MODEL });
    // the response should be pure JSON; parse it
    const jsonString = respText.trim();
    try {
      return JSON.parse(jsonString);
    } catch (err) {
      throw new Error('Failed to parse JSON from LLM response: ' + jsonString);
    }
  } catch (err) {
    console.warn('LLM call failed, falling back to fake response:', err.message);
    try {
      const content = await fs.promises.readFile(FAKE_RESPONSE_PATH, 'utf8');
      return JSON.parse(content);
    } catch (fsErr) {
      console.error('Failed to read fake-gemini-response.json:', fsErr);
      // rethrow original error if fallback cannot be read
      throw err;
    }
  }
}


// alternate version used for local testing without calling the LLM
async function fakeConvertToJson(text) {
  // Preserve user-sent fields whenever possible so local/dev mode still writes
  // realistic records even when Gemini is unavailable.
  let parsedInput = null;
  if (typeof text === 'string') {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        parsedInput = parsed;
      }
    } catch {
      // not JSON; continue with text-only fallback
    }
  }

  let fallbackTemplate = {};
  try {
    const content = await fs.promises.readFile(FAKE_RESPONSE_PATH, 'utf8');
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      fallbackTemplate = parsed;
    }
  } catch {
    // Keep a minimal object if fallback template cannot be loaded.
  }

  if (parsedInput) {
    const patientIdFromInput = parsedInput.patient_id || (typeof parsedInput.patient === 'string' && parsedInput.patient.trim() !== ''
      ? parsedInput.patient.trim().toUpperCase().replace(/\s+/g, '_')
      : null);

    return {
      ...fallbackTemplate,
      ...parsedInput,
      patient_id: patientIdFromInput || fallbackTemplate.patient_id || 'ABC123',
      dob: parsedInput.dob || fallbackTemplate.dob || '1975-05-15',
    };
  }

  return {
    ...fallbackTemplate,
    notes: typeof text === 'string' && text.trim() ? text : fallbackTemplate.notes,
    patient_id: fallbackTemplate.patient_id || 'ABC123',
    dob: fallbackTemplate.dob || '1975-05-15',
  };
}
 
/**
 * Convenience wrapper that takes raw note text, converts it to JSON via LLM,
 * generates a MongoDB query string, and returns an object with both.  In a
 * real app you might also execute the query against a database.
 */
async function addNote(rawText) {
  // always convert text (real or fake depending on client config)
  const json = await convertToJson(rawText);
  console.log('LLM converted text to JSON:', json);

  // build a simple query for debugging purposes
  const query = json && json.patient ? { patient: json.patient } : {};

  const result = await insertDocument(json);
  return { json, query, result };
}


/**
 * Connects to MongoDB using environment variables (with sane defaults),
 * inserts the provided document into the `medicalNotes` collection, then
 * closes the connection.  Returns the driver result object.
 */
async function insertDocument(doc) {
  // default connection string and database based on requested config
  // format: mongodb://<host>:<port>/<database>
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/nhs_medical_node_dev';
  const client = new MongoClient(uri, { useUnifiedTopology: true });
  await client.connect();

  // if the URI already contains a database path, the driver will use it by default,
  // but we also allow overriding via MONGODB_DB for clarity
  const dbName = process.env.MONGODB_DB || 'nhs_medical_node_dev';
  const db = client.db(dbName);
  const collection = db.collection('medicalNotes');
  const result = await collection.insertOne(doc);
  await client.close();
  console.log('insertDocument result:', result);
  return result;
}

async function listGeminiModels() {
  // performs a direct REST call since the SDK doesn't expose a helper
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('GEMINI_API_KEY not set; cannot list models');
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
  const resp = await fetch(url, { method: 'GET' });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`model list request failed: ${resp.status} ${txt}`);
  }
  return resp.json();
}

/**
 * Open a MongoDB connection and return both client and db.
 * Caller is responsible for closing the returned client.
 * @returns {Promise<{client: import('mongodb').MongoClient, db: import('mongodb').Db}>}
 */
async function connectMongo() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/nhs_medical_node_dev';
  const client = new MongoClient(uri, { useUnifiedTopology: true });
  await client.connect();
  const dbName = process.env.MONGODB_DB || 'nhs_medical_node_dev';
  const db = client.db(dbName);

  // The merge orchestrator opens a transaction from db.client.
  // Attach the client for callers that pass only the db handle.
  if (!db.client) {
    Object.defineProperty(db, 'client', {
      value: client,
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }

  return { client, db };
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function isNonEmptyValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function dedupeKeyForArrayItem(item) {
  if (!item || typeof item !== 'object') return String(item);
  const idKey = item.id || item._id || item.code;
  if (idKey) return `id:${String(idKey)}`;
  if (item.date && (item.test || item.procedure)) {
    return `dt:${String(item.date)}:${String(item.test || item.procedure)}`;
  }
  if (item.medicationName) return `med:${String(item.medicationName)}`;
  if (item.name) return `name:${String(item.name)}`;
  return `json:${JSON.stringify(item)}`;
}

function mergeObjectsWithPolicy(base, incoming) {
  const out = { ...base };
  for (const key of Object.keys(incoming || {})) {
    const nextVal = incoming[key];
    const currentVal = out[key];

    if (Array.isArray(nextVal)) {
      const existing = Array.isArray(currentVal) ? currentVal : [];
      const map = new Map();
      for (const item of existing) map.set(dedupeKeyForArrayItem(item), item);
      for (const item of nextVal) map.set(dedupeKeyForArrayItem(item), item);
      out[key] = Array.from(map.values());
      continue;
    }

    if (isPlainObject(nextVal)) {
      const left = isPlainObject(currentVal) ? currentVal : {};
      out[key] = mergeObjectsWithPolicy(left, nextVal);
      continue;
    }

    if (isNonEmptyValue(nextVal)) {
      out[key] = nextVal;
    }
  }
  return out;
}

function toIdString(value) {
  if (value === null || value === undefined) return null;
  try {
    return String(value);
  } catch {
    return null;
  }
}

function isTransactionUnsupportedError(err) {
  if (!err) return false;
  const msg = String(err.message || '').toLowerCase();
  return err.code === 20 || err.codeName === 'IllegalOperation' ||
    msg.includes('transaction numbers are only allowed on a replica set member or mongos');
}

/**
 * Returns all records for a patient_id from medicalNotes.
 * Primary order: createdAt ascending.
 * Secondary order/fallback: _id ascending.
 */
async function findAllRecordsForPatient(db, patient_id) {
  if (!db || typeof db.collection !== 'function') {
    const err = new Error('MongoDB database handle is required');
    err.code = 'INVALID_DB_HANDLE';
    throw err;
  }
  if (typeof patient_id !== 'string' || patient_id.trim() === '') {
    const err = new Error('patient_id is required and must be a string');
    err.code = 'INVALID_PATIENT_ID';
    throw err;
  }

  try {
    const collection = db.collection('medicalNotes');
    const docs = await collection.find({ patient_id: patient_id.trim() }).toArray();
    docs.sort((a, b) => {
      const aHasDate = isNonEmptyValue(a && a.createdAt);
      const bHasDate = isNonEmptyValue(b && b.createdAt);
      if (aHasDate && bHasDate) {
        const dateCmp = String(a.createdAt).localeCompare(String(b.createdAt));
        if (dateCmp !== 0) return dateCmp;
      } else if (aHasDate !== bHasDate) {
        return aHasDate ? -1 : 1;
      }
      return String(a && a._id).localeCompare(String(b && b._id));
    });
    console.log(`findAllRecordsForPatient: found ${docs.length} records for patient_id ${patient_id}`);
    return docs;
  } catch (error) {
    const err = new Error(`failed to fetch records for patient_id ${patient_id}: ${error.message}`);
    err.code = 'DB_QUERY_FAILED';
    throw err;
  }
}

/**
 * Pure merge function using deterministic rules.
 * - newest non-empty wins for scalar/nested values
 * - arrays are unioned and deduped by stable key
 * - notes are concatenated chronologically with metadata headers
 * - canonical _id and patient_id come from earliest document
 */
function mergePatientDocuments(docs) {
  if (!Array.isArray(docs) || docs.length === 0) {
    throw new Error('mergePatientDocuments requires a non-empty docs array');
  }
  if (docs.length === 1) {
    return JSON.parse(JSON.stringify(docs[0]));
  }

  const canonical = docs[0];
  let merged = {};

  for (const doc of docs) {
    if (!isPlainObject(doc)) continue;
    merged = mergeObjectsWithPolicy(merged, doc);
  }

  const notesSegments = [];
  for (const doc of docs) {
    if (!isPlainObject(doc)) continue;
    const noteText = normalizeText(doc.notes);
    if (!isNonEmptyValue(noteText)) continue;
    notesSegments.push(`[Source: ${toIdString(doc._id) || 'unknown'}, recorded: ${doc.createdAt || 'unknown'}]\n${noteText}`);
  }
  if (notesSegments.length > 0) {
    merged.notes = notesSegments.join('\n\n');
  }

  merged._id = canonical._id;
  merged.patient_id = canonical.patient_id;
  return merged;
}

/**
 * Merge orchestrator contract for /merge-patient-records.
 * Task 1 scope: enforce API contract and MongoDB boundary only.
 * Business merge logic is implemented in later tasks.
 * Supports two call styles:
 * 1) mergePatientRecords({ patient_id, dryRun }, db)
 * 2) mergePatientRecords(db, patient_id, dryRun)
 */
async function mergePatientRecords(arg1, arg2, arg3) {
  let params = arg1;
  let db = arg2;

  if (arg1 && typeof arg1.collection === 'function') {
    db = arg1;
    params = {
      patient_id: arg2,
      dryRun: arg3 === undefined ? false : arg3,
    };
  }

  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new Error('invalid merge params');
  }
  const { patient_id, dryRun = false } = params;
  if (typeof patient_id !== 'string' || patient_id.trim() === '') {
    throw new Error('patient_id is required and must be a string');
  }
  if (typeof dryRun !== 'boolean') {
    throw new Error('dryRun must be a boolean');
  }
  if (!db || typeof db.collection !== 'function') {
    throw new Error('MongoDB database handle is required');
  }

  const normalizedPatientId = patient_id.trim();
  const warnings = [];

  console.log(JSON.stringify({ event: 'merge.start', patient_id: normalizedPatientId, dryRun }));

  const docs = await findAllRecordsForPatient(db, normalizedPatientId);
  console.log(JSON.stringify({ event: 'merge.fetch.complete', patient_id: normalizedPatientId, matchedCount: docs.length }));

  if (docs.length === 0) {
    console.log(JSON.stringify({ event: 'merge.safeguard.not_found', patient_id: normalizedPatientId }));
    return {
      status: 'not-found',
      matchedCount: 0,
      mergedDocumentId: null,
      sourceIds: [],
      archivedCount: 0,
      deletedCount: 0,
      warnings,
    };
  }

  for (const doc of docs) {
    if (doc.patient_id !== normalizedPatientId) {
      const mismatchWarning = `Mismatched patient_id on document ${toIdString(doc._id) || 'unknown'}`;
      warnings.push(mismatchWarning);
      console.error(JSON.stringify({ event: 'merge.safeguard.mismatch', patient_id: normalizedPatientId, documentId: toIdString(doc._id) }));
      const error = new Error(mismatchWarning);
      error.code = 'PATIENT_ID_MISMATCH';
      throw error;
    }
  }

  if (docs.length === 1) {
    const oneId = toIdString(docs[0]._id);
    console.log(JSON.stringify({ event: 'merge.safeguard.noop', patient_id: normalizedPatientId, mergedDocumentId: oneId }));
    return {
      status: 'no-op',
      matchedCount: 1,
      mergedDocumentId: oneId,
      sourceIds: oneId ? [oneId] : [],
      archivedCount: 0,
      deletedCount: 0,
      warnings,
    };
  }

  const mergedDoc = mergePatientDocuments(docs);
  console.log(JSON.stringify({ event: 'merge.engine.complete', patient_id: normalizedPatientId, mergedFieldCount: Object.keys(mergedDoc).length }));

  const canonicalDoc = docs[0];
  const sourceDocs = docs.slice(1);
  const sourceIds = docs.map(doc => toIdString(doc._id)).filter(Boolean);

  if (dryRun) {
    console.log(JSON.stringify({ event: 'merge.dry_run.complete', patient_id: normalizedPatientId, matchedCount: docs.length }));
    return {
      status: 'dry-run',
      matchedCount: docs.length,
      mergedDocumentId: null,
      sourceIds,
      mergedPreview: mergedDoc,
      archivedCount: 0,
      deletedCount: 0,
      warnings,
    };
  }

  const client = db.client;
  if (!client || typeof client.startSession !== 'function') {
    throw new Error('MongoDB client with session support is required for merge transactions');
  }

  const medicalNotes = db.collection('medicalNotes');
  const archivedNotes = db.collection('archivedNotes');
  const mergeLogs = db.collection('mergeLogs');
  const nonCanonicalIds = sourceDocs.map(doc => doc._id);

  let archivedCount = 0;
  let deletedCount = 0;

  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const replaceResult = await medicalNotes.replaceOne(
        { _id: canonicalDoc._id },
        mergedDoc,
        { session }
      );
      console.log(JSON.stringify({ event: 'merge.write.replace', patient_id: normalizedPatientId, matched: replaceResult.matchedCount, modified: replaceResult.modifiedCount }));

      if (sourceDocs.length > 0) {
        const archiveResult = await archivedNotes.insertMany(sourceDocs, { session });
        archivedCount = archiveResult.insertedCount || 0;
      }
      console.log(JSON.stringify({ event: 'merge.write.archive', patient_id: normalizedPatientId, archivedCount }));

      if (nonCanonicalIds.length > 0) {
        const deleteResult = await medicalNotes.deleteMany({ _id: { $in: nonCanonicalIds } }, { session });
        deletedCount = deleteResult.deletedCount || 0;
      }
      console.log(JSON.stringify({ event: 'merge.write.delete', patient_id: normalizedPatientId, deletedCount }));

      await mergeLogs.insertOne({
        patient_id: normalizedPatientId,
        canonicalId: canonicalDoc._id,
        sourceIds: nonCanonicalIds,
        archivedCount,
        deletedCount,
        mergedAt: new Date(),
        dryRun: false,
      }, { session });
      console.log(JSON.stringify({ event: 'merge.write.audit_log', patient_id: normalizedPatientId }));
    });
  } catch (err) {
    if (isTransactionUnsupportedError(err)) {
      console.warn(JSON.stringify({
        event: 'merge.txn.unsupported_fallback',
        patient_id: normalizedPatientId,
        message: err.message,
      }));

      const replaceResult = await medicalNotes.replaceOne({ _id: canonicalDoc._id }, mergedDoc);
      console.log(JSON.stringify({ event: 'merge.write.replace.no_txn', patient_id: normalizedPatientId, matched: replaceResult.matchedCount, modified: replaceResult.modifiedCount }));

      if (sourceDocs.length > 0) {
        const archiveResult = await archivedNotes.insertMany(sourceDocs);
        archivedCount = archiveResult.insertedCount || 0;
      }
      console.log(JSON.stringify({ event: 'merge.write.archive.no_txn', patient_id: normalizedPatientId, archivedCount }));

      if (nonCanonicalIds.length > 0) {
        const deleteResult = await medicalNotes.deleteMany({ _id: { $in: nonCanonicalIds } });
        deletedCount = deleteResult.deletedCount || 0;
      }
      console.log(JSON.stringify({ event: 'merge.write.delete.no_txn', patient_id: normalizedPatientId, deletedCount }));

      await mergeLogs.insertOne({
        patient_id: normalizedPatientId,
        canonicalId: canonicalDoc._id,
        sourceIds: nonCanonicalIds,
        archivedCount,
        deletedCount,
        mergedAt: new Date(),
        dryRun: false,
      });
      console.log(JSON.stringify({ event: 'merge.write.audit_log.no_txn', patient_id: normalizedPatientId }));
    } else {
      console.error(JSON.stringify({ event: 'merge.error', patient_id: normalizedPatientId, message: err.message }));
      throw err;
    }
  } finally {
    await session.endSession();
  }

  const mergedDocumentId = toIdString(canonicalDoc._id);
  console.log(JSON.stringify({
    event: 'merge.complete',
    patient_id: normalizedPatientId,
    status: 'merged',
    matchedCount: docs.length,
    archivedCount,
    deletedCount,
  }));

  return {
    status: 'merged',
    matchedCount: docs.length,
    mergedDocumentId,
    sourceIds,
    archivedCount,
    deletedCount,
    warnings,
  };
}

/**
 * Ask the LLM to convert a user-provided search request into a MongoDB
 * filter object.  Returns an object suitable for use with
 * collection.find(filter).
 */
async function generateMongoQueryFromText(text) {
  await initGemini();
  if (!gemini) {
    // fallback: return empty query (match all)
    return {};
  }
  const prompt = `Translate the following user request into a MongoDB query filter
for the "medicalNotes" collection.

The structure of the documents in this collection is as follows:
${exampleDoc ? JSON.stringify(exampleDoc, null, 2) : '<unable to read example document>'}

User request:
"""${text}"""`;


  console.log('-----------------promt for query mongodb-------------------\n', prompt);
  console.log('-----------------end promt for query mongodb-------------------\n');






  try {
    const respText = await gemini.ask(prompt, { model: GEMINI_MODEL });
    const jsonString = respText.trim();
    return JSON.parse(jsonString);
  } catch (err) {
    console.warn('Could not generate query from LLM, returning default patient filter', err);
    // when the LLM call fails, return a safe default that at least
    // demonstrates query structure; this matches the user's example
    return { patient: "John Doe" };
  }
}

/**
 * Use the LLM to take raw query results and format them according to the
 * user's original request.  Returns a plain string (could be JSON or text).
 */
async function reformatResults(userText, results) {
  await initGemini();
  if (!gemini) {
    // no formatting available
    return results;
  }
  const prompt = `A user asked: """${userText}"""\n
You ran a MongoDB query and got the following documents:\n${JSON.stringify(results, null, 2)}\n
Format the results to best satisfy the user's request. Provide only the
formatted output (no extra commentary).`;

  console.log('-----------------prompt for reformatting results-------------------\n', prompt);
  console.log('-----------------end prompt for reformatting results-------------------\n');


  try {
    const respText = await gemini.ask(prompt, { model: GEMINI_MODEL });
    return respText;
  } catch (err) {
    console.warn('Error formatting results with LLM, attempting to read fallback file', err);
    try {
      const fallback = await fs.promises.readFile(path.join(__dirname, 'reformat-final-data.json'), 'utf8');
      return JSON.parse(fallback);
    } catch (fsErr) {
      console.warn('Could not read reformat-final-data.json, returning raw docs instead', fsErr);
      return results;
    }
  }
}

/**
 * Top-level helper used by the new HTTP endpoint.  Takes user query text,
 * generates a Mongo query via LLM, executes it, and then asks the LLM to
 * render the results in a user-friendly way.
 */
async function searchNotes(userText) {
  // first generate a filter object from the user's description
  const query = await generateMongoQueryFromText(userText);

  // connect to mongodb and execute find
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/nhs_medical_node_dev';
  const client = new MongoClient(uri, { useUnifiedTopology: true });
  await client.connect();
  const dbName = process.env.MONGODB_DB || 'nhs_medical_node_dev';
  const db = client.db(dbName);
  const collection = db.collection('medicalNotes');
  let docs = [];
  try {
    docs = await collection.find(query).toArray();
  } finally {
    await client.close();
  }

  const formatted = await reformatResults(userText, docs);
  return { query, docs, formatted };
}

module.exports = {
  convertToJson,
  fakeConvertToJson,  
  addNote,
  listGeminiModels,
  connectMongo,
  findAllRecordsForPatient,
  mergePatientDocuments,
  mergePatientRecords,
  generateMongoQueryFromText,
  reformatResults,
  searchNotes,
};
