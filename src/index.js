// load environment variables from .env (GEMINI_API_KEY, etc.)
// override:true ensures the file wins over any shell vars set earlier
require('dotenv').config({ override: true });

const http = require('http');
const url = require('url');
const {
    addNote,
    listGeminiModels,
    searchNotes,
    connectMongo,
    mergePatientRecords,
    updatePatientRecord,
    validateUpdateRequest,
    normaliseDate,
} = require('./llmHelpers');


// In-memory storage for medical notes
let medicalNotes = [];

const PORT = process.env.PORT || 3000;

// Helper function to parse JSON body
function parseBody(req, callback) {
    let body = '';
    req.on('data', chunk => {
        body += chunk.toString();
    });
    req.on('end', () => {
        try {
            callback(null, body ? JSON.parse(body) : {});
        } catch (error) {
            callback(error);
        }
    });
}

// Create HTTP server
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const method = req.method;

    // Set CORS headers
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle OPTIONS requests
    if (method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Route: Add note data
    if (pathname === '/add-note' && method === 'POST') {
        console.log('Incoming POST /add-note');
        // NOTE: callback declared async so we can use await inside
        parseBody(req, async (error, data) => {
            console.log('Parsed body for add-note:', error || data);
            if (res.headersSent) return;

            if (error) {
                res.writeHead(400);
                res.end(JSON.stringify({ 
                    success: false, 
                    message: 'Invalid JSON data' 
                }));
                return;
            }

            // call the LLM helper before saving; pass whatever text field the client supplies
            try {
                const rawText = data.text || data.note || JSON.stringify(data);
                const llmResult = await addNote(rawText);
                console.log('LLM addNote result:', llmResult);
            } catch (err) {
                console.error('LLM helper error:', err);
            }

            // create and store a new note
            const newNote = {
                id: medicalNotes.length + 1,
                ...data,
                createdAt: new Date().toISOString()
            };
            medicalNotes.push(newNote);
            console.log('Medical notes after push:', medicalNotes);

            res.writeHead(201);
            res.end(JSON.stringify({ 
                success: true, 
                message: 'Note added',
                data: newNote
            }));
        });
        return;
    }

 


    // Additional routes
    if (pathname === '/get-data' && method === 'GET') {
        console.log('Incoming GET /get-data', parsedUrl.query);
        const id = parsedUrl.query.id;
        if (id) {
            const note = medicalNotes.find(n => n.id === parseInt(id, 10));
            if (note) {
                res.writeHead(200);
                res.end(JSON.stringify({ success: true, data: note }));
            } else {
                res.writeHead(404);
                res.end(JSON.stringify({ success: false, message: 'Note not found' }));
            }
        } else {
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, data: medicalNotes }));
        }
        return;
    }

    if (pathname === '/write-data' && method === 'POST') {
        console.log('Incoming POST /write-data');
        parseBody(req, (error, data) => {
            console.log('Parsed body for write-data:', error || data);
            if (res.headersSent) return;
            if (error) {
                res.writeHead(400);
                res.end(JSON.stringify({ success: false, message: 'Invalid JSON data' }));
                return;
            }

            const idx = medicalNotes.findIndex(n => n.id === data.id);
            if (idx === -1) {
                res.writeHead(404);
                res.end(JSON.stringify({ success: false, message: 'Note not found' }));
                return;
            }

            // merge updates
            medicalNotes[idx] = { ...medicalNotes[idx], ...data, updatedAt: new Date().toISOString() };
            console.log('Medical notes after update:', medicalNotes);
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, data: medicalNotes[idx] }));
        });
        return;
    }

    // New route: list available Gemini models
    if (pathname === '/list-models' && method === 'GET') {
        console.log('Incoming GET /list-models');
        try {
            const models = await listGeminiModels();
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, data: models }));
        } catch (err) {
            console.error('error listing models', err);
            res.writeHead(500);
            res.end(JSON.stringify({ success: false, message: err.message }));
        }
        return;
    }

    // New route: search/query using LLM-generated MongoDB filter
    if (pathname === '/query' && method === 'POST') {
        console.log('Incoming POST /query');
        parseBody(req, async (error, data) => {
            console.log('Parsed body for query:', error || data);
            if (res.headersSent) return;
            if (error) {
                res.writeHead(400);
                res.end(JSON.stringify({ success: false, message: 'Invalid JSON data' }));
                return;
            }

            const userText = data.text || data.query || '';
            try {
                const { query, docs, formatted } = await searchNotes(userText);
                res.writeHead(200);
                res.end(JSON.stringify({ success: true, query, data: docs, formatted }));
            } catch (err) {
                console.error('searchNotes error', err);
                res.writeHead(500);
                res.end(JSON.stringify({ success: false, message: err.message }));
            }
        });
        return;
    }

    // Scope boundary for merge feature:
    // - This route must use MongoDB-backed helpers only.
    // - Do not read from or write to in-memory medicalNotes for merge behavior.
    if (pathname === '/merge-patient-records' && method === 'POST') {
        console.log('Incoming POST /merge-patient-records');
        parseBody(req, async (error, data) => {
            if (res.headersSent) return;
            if (error) {
                res.writeHead(400);
                res.end(JSON.stringify({ success: false, message: 'Invalid JSON data' }));
                return;
            }

            const patientId = data && data.patient_id;
            const hasDryRun = Object.prototype.hasOwnProperty.call(data || {}, 'dryRun');
            const dryRun = hasDryRun ? data.dryRun : false;

            if (typeof patientId !== 'string' || patientId.trim() === '') {
                res.writeHead(400);
                res.end(JSON.stringify({ success: false, message: 'patient_id is required and must be a string' }));
                return;
            }
            if (hasDryRun && typeof dryRun !== 'boolean') {
                res.writeHead(400);
                res.end(JSON.stringify({ success: false, message: 'dryRun must be a boolean when provided' }));
                return;
            }

            let client = null;
            try {
                const connection = await connectMongo();
                client = connection.client;
                const result = await mergePatientRecords(
                    connection.db,
                    patientId.trim(),
                    dryRun
                );

                const statusCode = result && result.status === 'not-found' ? 404 : 200;
                res.writeHead(statusCode);
                res.end(JSON.stringify(result));
            } catch (err) {
                console.error('mergePatientRecords error', err);
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'internal error' }));
            } finally {
                if (client) {
                    try {
                        await client.close();
                    } catch (closeErr) {
                        console.error('Failed to close MongoDB client', closeErr);
                    }
                }
            }
        });
        return;
    }

    // Route: Update a patient record by patient_id + exact date
    // Scope: MongoDB-backed only. Does not touch the in-memory medicalNotes array.
    if (pathname === '/update-patient-record' && method === 'POST') {
        console.log('Incoming POST /update-patient-record');
        parseBody(req, async (error, data) => {
            if (res.headersSent) return;

            if (error) {
                res.writeHead(400);
                res.end(JSON.stringify({ success: false, message: 'Invalid JSON data' }));
                return;
            }

            // Validate and normalise request payload
            let patient_id, date, results;
            try {
                ({ patient_id, date, results } = validateUpdateRequest(data));
            } catch (validationErr) {
                res.writeHead(validationErr.statusCode || 400);
                res.end(JSON.stringify({ success: false, message: validationErr.message }));
                return;
            }

            let client = null;
            try {
                const connection = await connectMongo();
                client = connection.client;

                const result = await updatePatientRecord(connection.db, patient_id, date, results);

                if (result.status === 'not-found') {
                    res.writeHead(404);
                    res.end(JSON.stringify({
                        success: false,
                        message: `No record found for patient_id="${patient_id}" on date="${date}"`,
                    }));
                    return;
                }

                res.writeHead(200);
                res.end(JSON.stringify({
                    success: true,
                    message: 'Record updated successfully',
                    data: result.document,
                }));
            } catch (err) {
                console.error('updatePatientRecord error', err);
                res.writeHead(500);
                res.end(JSON.stringify({ success: false, message: err.message || 'Internal server error' }));
            } finally {
                if (client) {
                    try {
                        await client.close();
                    } catch (closeErr) {
                        console.error('Failed to close MongoDB client after update', closeErr);
                    }
                }
            }
        });
        return;
    }

    // Route not found
    res.writeHead(404);
    res.end(JSON.stringify({
        success: false,
        message: 'Route not found',
        availableRoutes: [
            'POST /add-note - Add a new medical note',
            'GET /get-data - Get all notes or specific note by id query param',
            'POST /write-data - Update an existing note by id',
            'POST /query - Run LLM-generated MongoDB search and format results',
            'POST /merge-patient-records - Validate merge contract and call MongoDB merge orchestrator',
            'POST /update-patient-record - Update a patient record by patient_id and date',
        ]
    }));
});

module.exports = { server };

// Start server only when run directly (not when required by tests)
if (require.main === module) {
    server.listen(PORT, () => {
        console.log(`NHS Medical Note Services running on port ${PORT}`);
        console.log(`\nAvailable endpoints:`);
        console.log(`  POST http://localhost:${PORT}/add-note`);
        console.log(`  GET  http://localhost:${PORT}/get-data`);
        console.log(`  POST http://localhost:${PORT}/write-data`);
        console.log(`  POST http://localhost:${PORT}/query`);
        console.log(`  POST http://localhost:${PORT}/merge-patient-records`);
        console.log(`  POST http://localhost:${PORT}/update-patient-record`);
    });
}

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
    });
});
