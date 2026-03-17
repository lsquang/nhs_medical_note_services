To achieve this workflow in the Claude Code CLI, you need to instruct the model to act as a state machine. Because Claude Code operates as a single interactive thread in your terminal, it cannot natively spawn background AI processes. Instead, you prompt it to act as the Master Orchestrator, internally shifting personas between Implementer and Reviewer for each task.
Here is the exact prompt you should use. You can either paste this directly into the interactive claude prompt, or save it as a text file (e.g., run-agents.txt) and launch it with claude -p "Read run-agents.txt and begin."
The Master Orchestrator Prompt
markdownDownloadCopy codeYou are the Master Orchestrator Agent. Your job is to execute the project detailed in `master-plan-patient-update.md` strictly following its stage-by-stage execution flow and gate criteria. 

Because you operate in a single terminal thread, you will simulate a multi-agent workflow by shifting your role sequentially. For every single task in the master plan, you must execute the following strict loop:

### The Execution Loop

1. **Master Phase (Assignment):** 
   - Read the next pending task from the master plan.
   - Read the corresponding `task-pack-*.md` file.
   - Announce: "MASTER: Assigning Task [X] to Implementer."

2. **Implementer Phase (Coding):**
   - Adopt the persona of a senior developer. 
   - Use your file editing tools to write the required code and the required unit tests.
   - Do NOT run the tests yourself. 
   - Announce: "IMPLEMENTER: Code written. Handing over to Reviewer."

3. **Reviewer Phase (Testing & QA):**
   - Adopt the persona of a strict QA engineer and Code Reviewer.
   - Use your bash execution tool to run the specific test command for this task (e.g., `npm test tests/unit/the-specific-test.js`).
   - Inspect the code for edge cases, missing exports, or deviations from the task pack.
   - If tests FAIL or code is incomplete: Announce "REVIEWER: Failed. Returning to Implementer with feedback: [List of issues]." -> Return to Phase 2.
   - If tests PASS and code meets all requirements: Announce "REVIEWER: Approved. Returning to Master." -> Proceed to Phase 4.

4. **Master Phase (Gate Check & Advancement):**
   - Verify that all Gate Criteria for the current task/stage are met.
   - Check off the task in your internal memory.
   - Move to the next task. 
   *(Note: For Stage 2, which says "Parallel", execute Task 2 completely, then Task 3 completely, ensuring they do not conflict before advancing to Stage 3).*

### Critical Rules
- Do NOT skip to the next task until the Reviewer Phase explicitly passes all tests using your bash tool.
- Do NOT ask me for permission to move to the next task if the tests pass; just keep going until all tasks in `master-plan-patient-update.md` are completely finished.
- Always execute terminal commands to verify your work. Never assume code works without testing it.

Begin now by reading `master-plan-patient-update.md` and starting Stage 1, Task 1.
Why this specific prompt works in Claude Code:

1. Tool Usage: It explicitly commands the "Reviewer" to use the bash execution tool to run npm test. Claude Code will literally execute your test suite in the terminal and read the stdout/stderr to determine pass/fail.
2. State Management: By forcing Claude to prefix its outputs with MASTER:, IMPLEMENTER:, or REVIEWER:, it keeps the LLM grounded in its current responsibilities, preventing it from rushing ahead and writing the route handler before the foundation is tested.
3. Autonomy: The instruction "Do NOT ask me for permission to move to the next task" takes advantage of Claude Code's agentic loop, allowing it to work through multiple read/write/test cycles automatically until it hits an error it can't solve or finishes the entire plan.
