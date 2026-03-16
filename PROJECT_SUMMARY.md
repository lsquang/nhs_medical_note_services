# NHS Medical Note Services Project Summary

## Purpose

This repository is a Node.js prototype service for ingesting, structuring, storing, retrieving, and querying medical notes. Its main design goal appears to be:

- Accept freeform medical note text from an API client.
- Use Gemini to convert that text into structured JSON.
- Store the structured note in MongoDB.
- Allow natural-language querying of stored notes.
- Use Gemini again to translate user intent into a MongoDB filter and optionally reformat the returned result set.

At the moment, the implementation is only partially aligned with that goal. The current codebase mixes in-memory CRUD behavior with MongoDB-backed LLM search, which is the most important architectural issue for future development.

## Repository Structure

Top-level files and their current roles:

- [index.js](index.js): Main application entrypoint. Starts the HTTP server, parses requests, defines routes, and stores notes in memory.
- [llmHelpers.js](llmHelpers.js): Gemini integration and MongoDB logic. Handles note conversion, document insertion, model listing, query generation, result formatting, and natural-language search.
- [package.json](package.json): Package manifest, scripts, and dependency declarations.
- [package-lock.json](package-lock.json): Locked dependency tree confirming installed package versions.
- [data-structure.json](data-structure.json): Example note document shape used in LLM prompts for query generation.
- [fake-gemini-response.json](fake-gemini-response.json): Fallback structured note response when Gemini conversion fails.
- [reformat-final-data.json](reformat-final-data.json): Fallback formatted output used when Gemini result formatting fails.
- [requests.http](requests.http): Manual HTTP request collection for local testing.
- [.gitignore](.gitignore): Ignore rules for node_modules, logs, .env, IDE files, and local artifacts.

## Technology Stack

Confirmed from [package.json](package.json) and [package-lock.json](package-lock.json):

- Runtime: Node.js
- HTTP layer: Native Node http module, not Express or Fastify
- Environment config: dotenv 17.3.1
- LLM SDK: gemini-ai 2.2.1
- Database driver: mongodb 5.x
- Dev server: nodemon 2.x

Runtime implications:

- The code uses global fetch in [llmHelpers.js](llmHelpers.js), which strongly suggests Node 18+ is expected.
- The gemini-ai dependency pulls in packages that also target modern Node versions.
- There is no TypeScript, no build step, and no transpilation layer.

## Application Entry Point

The service starts in [index.js](index.js).

Key startup behavior:

- Loads environment variables via dotenv with override enabled.
- Creates a plain HTTP server.
- Sets permissive CORS headers on all requests.
- Parses JSON bodies manually through a callback-based helper.
- Registers route handling inline inside a single request handler.
- Listens on PORT or defaults to 3000.
- Handles SIGTERM by closing the HTTP server.

This is a minimal prototype architecture. There is no router abstraction, middleware system, input schema validation, request logging layer, centralized error handling, or service/repository separation.

## Runtime Architecture

The codebase currently has two distinct data paths:

1. In-memory notes handled directly in [index.js](index.js)
2. MongoDB-backed note operations handled in [llmHelpers.js](llmHelpers.js)

This split creates divergent application behavior depending on the route used.

### In-Memory Path

The array medicalNotes is defined in [index.js](index.js) and acts as the data store for:

- POST /add-note response payload creation
- GET /get-data
- POST /write-data

Characteristics:

- Data is lost on restart.
- IDs are generated as array length plus one.
- No persistence across process restarts.
- No synchronization with MongoDB updates.

### MongoDB Path

MongoDB is accessed through [llmHelpers.js](llmHelpers.js) and is used for:

- Inserting structured note documents during addNote
- Searching stored note documents during searchNotes

Characteristics:

- Uses MongoClient directly.
- Opens and closes a fresh connection for each operation.
- Defaults to database nhs_medical_node_dev.
- Uses collection medicalNotes.
- Operates independently of the in-memory array.

## Endpoints

### POST /add-note

Defined in [index.js](index.js).

Current behavior:

- Reads the JSON request body.
- Chooses raw note text from data.text, data.note, or JSON.stringify of the whole payload.
- Calls addNote from [llmHelpers.js](llmHelpers.js).
- addNote converts the text to JSON through Gemini or a fallback path.
- addNote then inserts the structured document into MongoDB.
- After that, [index.js](index.js) still creates a separate in-memory note object from the original request body.
- Returns the in-memory note object to the client.

Important consequence:

- The returned object is not necessarily the same as the MongoDB document actually inserted.
- If the LLM conversion changes structure, the client never sees that version in the API response.
- If the LLM or MongoDB insertion fails, the route still attempts to push the raw request data into memory and return success.

### GET /get-data

Defined in [index.js](index.js).

Current behavior:

- If id is provided as a query parameter, returns a single note from the in-memory array.
- Otherwise returns the full in-memory array.
- Does not read from MongoDB.

Important consequence:

- This route does not expose the persisted MongoDB documents.
- After a server restart, this route returns an empty set even if MongoDB has data.

### POST /write-data

Defined in [index.js](index.js).

Current behavior:

- Parses the request body.
- Locates a note by id in the in-memory array.
- Merges the update payload into that in-memory object.
- Adds updatedAt.
- Returns the updated in-memory object.
- Does not update MongoDB.

Important consequence:

- A note updated here can diverge permanently from the MongoDB copy used by search.

### GET /list-models

Defined in [index.js](index.js), implemented in [llmHelpers.js](llmHelpers.js).

Current behavior:

- Makes a direct REST request to the Google Generative Language API to list models.
- Requires GEMINI_API_KEY.
- Returns the raw model list response.

Important consequence:

- This is a diagnostic or discovery endpoint rather than a core product feature.

### POST /query

Defined in [index.js](index.js), implemented in [llmHelpers.js](llmHelpers.js).

Current behavior:

- Reads user natural-language search text from data.text or data.query.
- Calls searchNotes.
- searchNotes asks Gemini to translate the text into a MongoDB filter object.
- searchNotes connects to MongoDB and runs collection.find on that filter.
- searchNotes then asks Gemini to reformat the results according to the user request.
- Returns the query object, raw docs, and formatted output.

Important consequence:

- This endpoint does not consult the in-memory data at all.
- It can return data that GET /get-data will never show.

## Request Flow Summary

### Add Note Flow

Client request -> [index.js](index.js) -> parse JSON -> call addNote in [llmHelpers.js](llmHelpers.js) -> convert text with Gemini or fallback -> insert structured document into MongoDB -> create separate in-memory note from original request body -> return in-memory response

### Query Flow

Client request -> [index.js](index.js) -> parse JSON -> call searchNotes in [llmHelpers.js](llmHelpers.js) -> generate MongoDB filter with Gemini -> run MongoDB query -> reformat results with Gemini or fallback -> return query, raw docs, formatted output

### Read and Update Flow

Client request -> [index.js](index.js) -> interact only with in-memory array -> return result

## LLM Integration Details

The Gemini client is initialized lazily in [llmHelpers.js](llmHelpers.js).

Observed behavior:

- If GEMINI_API_KEY is missing, Gemini is disabled and fallback logic is used where available.
- GEMINI_MODEL defaults to gemini-1.5.
- If GEMINI_MODEL starts with models/, that prefix is stripped.
- The SDK is loaded dynamically with import because gemini-ai is an ES module.

Gemini is currently used for three separate jobs.

### 1. convertToJson

Defined in [llmHelpers.js](llmHelpers.js).

Purpose:

- Convert freeform medical note text into structured JSON.

Prompt behavior:

- Asks Gemini to return only a JSON object.
- Suggests keys such as patient, notes, test, date, and inferred attributes.

Failure behavior:

- If Gemini call fails or JSON parsing fails, it reads [fake-gemini-response.json](fake-gemini-response.json).

Planning implication:

- There is no schema validation after JSON parse.
- The prompt implies a schema but does not enforce one.

### 2. generateMongoQueryFromText

Defined in [llmHelpers.js](llmHelpers.js).

Purpose:

- Translate a natural-language user request into a MongoDB query filter.

Prompt behavior:

- Includes the full example document from [data-structure.json](data-structure.json).
- Asks Gemini to return a MongoDB filter for the medicalNotes collection.

Failure behavior:

- Returns a hardcoded default filter matching patient John Doe.

Planning implication:

- The fallback is not neutral and can silently return misleading results.
- The LLM output is trusted directly as a MongoDB filter object.

### 3. reformatResults

Defined in [llmHelpers.js](llmHelpers.js).

Purpose:

- Convert raw MongoDB query results into a format closer to what the user asked for.

Failure behavior:

- Falls back to [reformat-final-data.json](reformat-final-data.json).
- If that file cannot be read, returns raw results.

Planning implication:

- The route can return either raw docs, fallback canned output, or actual LLM-generated formatting depending on failure mode.
- There is no explicit metadata telling the caller which mode was used.

## Data Model Research

The strongest available example schema is in [data-structure.json](data-structure.json).

### Example Top-Level Fields

- _id
- patient
- test
- date
- diagnosis
- procedures
- comparison_studies
- findings
- assessment
- notes

### diagnosis Structure

- primary
- diagnosis_date
- stage
- tnm
- PD_L1_CPS

### diagnosis.tnm Structure

- pT
- pN
- cM
- resection_status

### findings Structure

- lungs
- pleura
- lymph_nodes
- cardiovascular
- spine_bone
- liver
- biliary_system
- spleen
- pancreas
- adrenal_glands
- kidneys
- gastrointestinal
- pelvis
- vessels

### procedures Example Shape

- procedure
- date

### comparison_studies Example Shape

- test
- date

## Schema Inconsistencies

The repo does not currently operate on one stable schema.

Observed schema variants:

1. Raw request payload accepted by POST /add-note
2. Prompt-target JSON shape in convertToJson
3. Example document in [data-structure.json](data-structure.json)
4. Fallback object in [fake-gemini-response.json](fake-gemini-response.json) or fakeConvertToJson

Specific mismatches:

- The request sample in [requests.http](requests.http) uses notes, plural.
- The code for add-note prefers data.text or data.note, singular, before falling back to the whole payload.
- fakeConvertToJson returns only patient_id and dob, which does not match the richer medical schema.
- Query generation assumes patient is a top-level field.
- The add route response returns raw request data, not the normalized document inserted into MongoDB.

Planning implication:

- Any next task involving validation, search quality, filtering, or persistence needs a single canonical document contract first.

## Environment Variables

The following environment variables are used by the codebase:

- PORT
- GEMINI_API_KEY
- GEMINI_MODEL
- MONGODB_URI
- MONGODB_DB

Default values and behavior:

- PORT defaults to 3000.
- GEMINI_MODEL defaults to gemini-1.5.
- MONGODB_URI defaults to mongodb://localhost:27017/nhs_medical_node_dev.
- MONGODB_DB defaults to nhs_medical_node_dev.
- The MongoDB collection name is medicalNotes.
- dotenv is loaded with override true in both [index.js](index.js) and [llmHelpers.js](llmHelpers.js), so .env values override existing environment values.

Operational consequence:

- The service assumes MongoDB is reachable locally unless overridden.
- Missing Gemini credentials do not fully break the app, but they push behavior into fallback paths.

## Testing and Developer Workflow

Current scripts from [package.json](package.json):

- start: node index.js
- dev: nodemon index.js
- test: placeholder that exits with error

Current testing situation:

- No real unit tests.
- No integration tests.
- No API contract tests.
- No schema validation tests.
- No mocks or fixtures beyond fallback JSON files.
- Manual endpoint testing is done through [requests.http](requests.http).

Planning implication:

- Any non-trivial refactor will be risky without first adding basic automated coverage or at least a repeatable manual verification process.

## Error Handling Research

Current error handling is basic and route-local.

Observed patterns:

- Invalid JSON body returns 400 in routes using parseBody.
- Gemini errors in add-note are logged, but the request still continues.
- Gemini or formatting failures often fall back silently to canned JSON files.
- MongoDB errors bubble up to 500 in query and model-list endpoints.
- There is no centralized logging or structured error output.

Important behavior:

- A client can receive a success response from POST /add-note even if LLM enrichment failed.
- The system does not tell the client whether structured storage was successful, whether fallback data was used, or whether MongoDB insert succeeded independently from the in-memory insert.

## Security and Compliance Observations

This project handles medical-note-shaped data, but security controls are minimal.

Observed gaps:

- No authentication
- No authorization
- No rate limiting
- No request size limits
- No input validation
- No data redaction
- No audit logging
- CORS is fully open
- No transport or deployment guidance for secure environments

Planning implication:

- If this system is intended for real healthcare workflows, security and compliance concerns need to be addressed before production use.
- Even if the system remains internal, data handling safeguards should be added early.

## Major Architectural Risk

The biggest issue in the current codebase is the split source of truth.

### Current Reality

- POST /add-note writes a structured version to MongoDB and a raw version to memory.
- GET /get-data reads only memory.
- POST /write-data updates only memory.
- POST /query reads only MongoDB.

### Resulting Problems

- Data returned by read endpoints can differ from data returned by search.
- Updates are not reflected consistently.
- Restarts wipe the dataset visible to GET /get-data.
- Search results may include documents that standard read endpoints cannot retrieve.
- API consumers cannot rely on a single, consistent note identity or shape.

### Planning Conclusion

- Before building major features, the app should choose one canonical persistence path, most likely MongoDB.

## Secondary Risks

### LLM Trust Boundary

- LLM output is used directly as parsed JSON and as a MongoDB query object.
- There is no schema validator or query sanitizer.

### Weak Fallback Semantics

- Fallbacks can produce apparently successful responses with canned or generic content.
- Callers are not informed when degraded mode is active.

### No Canonical Domain Schema

- Several incompatible note shapes are present in the codebase.
- Search quality and update reliability depend on schema stability.

### No Persistent App-Level CRUD

- Core CRUD endpoints are not backed by the database.

### Operational Thinness

- No healthcheck endpoint
- No README
- No .env.example
- No migration or seed tooling
- No automated tests

### Dependency Review Need

- [package-lock.json](package-lock.json) shows gemini-ai with GPL-3.0 licensing metadata, which may need review depending on distribution and legal constraints.

## requests.http Research Notes

The sample request file [requests.http](requests.http) shows the intended usage pattern.

Included examples:

- Add a long oncology-related CT note for John Doe
- Retrieve all notes
- Retrieve a note by id
- List Gemini models
- Update an in-memory note
- Query notes using natural language
- Query for patient-specific output with deduplication wording

What this reveals:

- The expected product experience is conversational or natural-language oriented.
- The app is meant to support rich radiology or oncology-style note content.
- Search behavior is expected to return structured data and possibly formatted summaries.

## What Is Missing

Important missing project assets and structures:

- README with setup and architecture notes
- .env.example
- Formal schema definition
- Validation layer
- Repository or service abstraction for data access
- Persistent CRUD implementation
- Real test suite
- Logging strategy
- Health endpoint
- Authentication and authorization
- Deployment guidance

## Practical Planning Guidance For The Next Task

If the next task is implementation planning, the strongest sequence is:

1. Unify persistence so all CRUD and search operations use one source of truth.
2. Define one canonical medical note schema.
3. Add validation for inbound payloads and LLM outputs.
4. Make degraded or fallback behavior explicit in API responses.
5. Add automated tests around note ingestion, persistence, and query translation.
6. Add operational basics such as README, env example, and healthcheck.

## Suggested Build Priorities

### Priority 1

- Replace in-memory CRUD with MongoDB-backed CRUD.
- Return persisted documents from add and update endpoints.

### Priority 2

- Introduce a single schema for notes.
- Validate both client input and Gemini output against it.

### Priority 3

- Harden query generation so unsafe or invalid LLM output cannot flow directly into MongoDB find.

### Priority 4

- Add tests and setup documentation.

### Priority 5

- Add security controls appropriate to the intended deployment context.

## Key Takeaways

- This repository is a working prototype, not yet a production-ready service.
- The main technical conflict is the split between in-memory CRUD and MongoDB-backed search.
- The main product opportunity is strong: structured medical-note ingestion plus natural-language retrieval.
- The next implementation task should be planned around persistence unification and schema definition first.
