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
  return {
    patient_id: 'ABC123',
    dob: '1975-05-15'
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
  generateMongoQueryFromText,
  reformatResults,
  searchNotes,
};
