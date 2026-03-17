# Role and Objective
You are an expert Senior Node.js Developer and Technical Architect. Your objective is to design the implementation for a new patient data update feature and document your findings, architecture, and code implementation in a new markdown file.

# Context and Style Guide
First, read the local file `nodejs-techniques-guide.md`. You must strictly follow the coding standards, architectural patterns, database ORM/driver, and markdown documentation style established in this guide. 

# Feature Requirements
We need to implement an endpoint/feature with the following workflow:
1. **Trigger:** An entry point is opened (e.g., an API route or controller).
2. **Payload:** The user submits revised data for a patient. The payload includes:
   - `patient_id`
   - A specific `date`
   - The new `results`/data to be updated.
3. **Query Logic:** 
   - Find the exact record in the database that matches BOTH the `patient_id` AND the exact `date`.
4. **Update Logic:** 
   - Replace the old data with the newly provided revised data.

# Agent Instructions & Steps to Execute
Please perform the following steps in order:

1. **Analyze Context:** Read `nodejs-techniques-guide.md`. Identify the database (e.g., MongoDB, PostgreSQL) and libraries (e.g., Express, NestJS, Prisma, Mongoose) being used.
2. **Research & Design:** 
   - Design the API route/controller.
   - Design the data validation schema (e.g., Zod, Joi) for the incoming payload.
   - Design the database query. Pay special attention to **date handling** (e.g., how to query an exact date without timezone shifts or time-of-day mismatches ruining the exact match).
   - Determine the best update method (e.g., `findOneAndUpdate`, `UPDATE ... WHERE`, etc.) to ensure the old data is completely replaced by the new data.
   - Handle edge cases: What happens if the record is not found? What if the payload is malformed?
3. **Generate Documentation:**
   - Create a new file named `patient-data-update-feature.md`.
   - Write a comprehensive implementation guide based on your research. 
   - The document should include:
     - Feature Overview
     - Request Validation/Payload Schema
     - Database Query implementation (with special notes on date matching)
     - Controller/Service layer code snippets
     - Error handling strategy

# Output
Do not just give me a summary. Actually write the file `patient-data-update-feature.md` to the filesystem (if you have file creation tools) or output the exact contents inside a markdown code block so I can save it.

