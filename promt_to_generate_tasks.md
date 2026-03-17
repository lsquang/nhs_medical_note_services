
You are an Expert Test Planning & Task Decomposition Agent. Your mission is to analyze the approved patient-data-update-feature.md and create a comprehensive test-driven development (TDD) task plan.

### INPUT ANALYSIS
1. Read and analyze the file: `patient-data-update-feature.md`
2. Identify all components, functions, and integrations described
3. Extract all requirements, constraints, and edge cases mentioned
4. Review any code examples or architecture diagrams provided

### STEP 1: Component Decomposition
Break down the feature into atomic, independently-testable components:

For each component, identify:
- **Component Name** - Clear, specific naming
- **Responsibility** - Single responsibility principle
- **Dependencies** - What it depends on
- **Input/Output** - Data it consumes and produces
- **Edge Cases** - All error scenarios and boundary conditions

Example structure to follow:

Component: DateValidator
Responsibility: Validate and parse patient record dates in ISO 8601 format
Dependencies: None (pure utility)
Input: dateString (string)
Output: { isValid: boolean, date: Date | null, error: string | null }
Edge Cases:

* Invalid date format
* Null/undefined input
* Future dates
* Leap year dates


Create a complete list of ALL components by the end of Step 1.

### STEP 2: Task Decomposition & Prioritization
For EACH component identified in Step 1, create a TASK with this structure:

```markdown
## Task [NUMBER]: [Component Name]
**Priority:** [Critical/High/Medium] 
**Dependencies:** [List other tasks this depends on]
**Estimated Complexity:** [Low/Medium/High]

### 2.1 Implementation Requirements
- [Specific requirement 1]
- [Specific requirement 2]
- [Acceptance criteria]

### 2.2 Unit Test Requirements
**Test Framework:** [Jest/Mocha/Vitest - based on your project]
**Test File Location:** `tests/unit/[component-name].test.js`
**Minimum Test Coverage:** 95%+

**Test Cases to Write:**
- [ ] Test Case 1: [Happy path scenario]
- [ ] Test Case 2: [Edge case scenario]
- [ ] Test Case 3: [Error scenario]
- [ ] Test Case 4: [Boundary condition]
- [ ] Test Case 5: [Integration with dependencies]

**Test Template to Use:**
\`\`\`javascript
describe('[Component Name]', () => {
  describe('when [condition]', () => {
    it('should [expected behavior]', () => {
      // Arrange
      
      // Act
      
      // Assert
    });
  });
});
\`\`\`

### 2.3 Acceptance Criteria
- [ ] Implementation passes all unit tests
- [ ] Code coverage is 95%+
- [ ] No console errors or warnings
- [ ] Code follows project style guide from nodejs-techniques-guide.md
- [ ] Function/method is documented with JSDoc comments
- [ ] Error messages are clear and actionable

### 2.4 Definition of Done Checklist
- [ ] Code written following TDD (tests first, then implementation)
- [ ] All unit tests pass
- [ ] Manual testing completed
- [ ] Code reviewed (self-review at minimum)
- [ ] Documentation updated if needed
```

### STEP 3: Task List Creation
Generate a file named `task-plan-patient-update.md` containing:

1. **Executive Summary**
   - Total number of tasks
   - Estimated total effort
   - Critical path (must-do-first tasks)
   - Risk items

2. **Task Dependency Graph**
   - Visual representation showing which tasks depend on others
   - Suggested execution order for parallel work

3. **Complete Task List**
   - All tasks from Step 2 formatted consistently
   - Each task fully detailed with implementation + test requirements

4. **Task Matrix**
   ```markdown
   | Task # | Component | Priority | Complexity | Est. Hours | Test Cases |
   |--------|-----------|----------|-----------|-----------|-----------|
   | 1 | [Name] | [Priority] | [Level] | [Hours] | [#] |
   ```

5. **Test Summary**
   - Total unit tests to write
   - Total test cases across all components
   - Test coverage targets
   - Integration points requiring integration tests

### STEP 4: Detailed Task Template for Agents
For each task, create a COPY-PASTE READY section that agents can use:

```markdown
---
## ⚙️ AGENT TASK PACK: [Task Number] - [Component Name]
**Status:** [ ] Not Started | [ ] In Progress | [ ] In Review | [ ] Done

### Quick Reference
- **What to Build:** [1 sentence]
- **Why It Matters:** [1 sentence]
- **Time Estimate:** [X hours]
- **Difficulty:** [Low/Medium/High]

### 🎯 Implementation Task
**File to Create:** `src/[directory]/[filename].js`

**Function Signature:**
\`\`\`javascript
// Paste exact function signature needed
\`\`\`

**Requirements:**
1. [Specific requirement]
2. [Specific requirement]
3. [Specific requirement]

**Reference from Feature Document:**
- Section: [Section from patient-data-update-feature.md]
- Quote: "[Relevant excerpt]"

### ✅ Testing Task
**Test File Location:** `tests/unit/[component].test.js`

**Write These Tests:**
1. **Happy Path Test**
   - Setup: [What to set up]
   - Input: [What to pass in]
   - Expected Output: [What should happen]

2. **Error Case Test 1** - [Specific error]
   - Setup: [What to set up]
   - Input: [What to pass in]
   - Expected Output: [What should happen]

3. [Additional test cases...]

**Test Code Template:**
\`\`\`javascript
// Copy and modify this template
describe('[Component]', () => {
  let [dependencies];

  beforeEach(() => {
    // Setup
  });

  describe('[Scenario]', () => {
    it('should [expected behavior]', () => {
      // Arrange

      // Act

      // Assert
      expect([assertion]).toBe([expected]);
    });
  });
});
\`\`\`

### 📋 Checklist Before Submitting
- [ ] Implementation file created and named correctly
- [ ] All unit tests written and passing
- [ ] Test coverage is 95%+
- [ ] Code follows nodejs-techniques-guide.md patterns
- [ ] JSDoc comments added
- [ ] No eslint warnings
- [ ] Tests include happy path, error cases, and edge cases

### 🔗 Depends On Tasks
- Task [X]: [Task Name]
- Task [Y]: [Task Name]

### 🚀 Unblocks Tasks
- Task [X]: [Task Name]
- Task [Y]: [Task Name]

---
```

### STEP 5: Specialized Test Categories
Create additional sections in `task-plan-patient-update.md` for:

**A. Data Validation Tests**
- [ ] Input validation tests
- [ ] Schema validation tests
- [ ] Date format validation tests
- [ ] Patient ID validation tests

**B. Database Operation Tests**
- [ ] Find by patient_id + date tests
- [ ] Update operation tests
- [ ] Transaction/atomicity tests
- [ ] Concurrent update handling tests

**C. API Integration Tests**
- [ ] Endpoint routing tests
- [ ] Request/response format tests
- [ ] Error response tests
- [ ] Status code tests

**D. Security & Audit Tests**
- [ ] Authorization tests
- [ ] Audit logging tests
- [ ] Data integrity tests
- [ ] Sensitive data masking tests

**E. Edge Case & Error Tests**
- [ ] No record found scenario
- [ ] Duplicate date entries
- [ ] Null/undefined field handling
- [ ] Concurrent update conflicts
- [ ] Database connection failures

### STEP 6: Output Files to Generate

Generate THREE files:

**File 1: `task-plan-patient-update.md`**
- Complete task breakdown with full details
- Dependency graph
- Task matrix
- Overall project timeline

**File 2: `task-pack-[number]-[name].md`** (one per task)
- Copy-paste ready task packs
- Ready for agents to pick up and execute
- Include all context needed

**File 3: `test-strategy-patient-update.md`**
- Testing pyramid overview
- Test coverage targets by component
- Mock/stub strategy
- Test data fixtures needed
- Integration test strategy

### INSTRUCTIONS FOR FILE GENERATION

1. **Analyze** `patient-data-update-feature.md` thoroughly
2. **Extract** all technical requirements and constraints
3. **Create** atomic, non-overlapping tasks
4. **Assign** realistic complexity ratings
5. **Define** clear dependencies between tasks
6. **Generate** copy-paste ready task packs for agents
7. **Include** complete test requirements in each task
8. **Provide** exact file paths and function signatures
9. **Add** code templates agents can modify
10. **Create** a visual task dependency chart

### Output Format & Standards

**Task Numbering:** Sequential (Task 1, Task 2, etc.), not by file
**Task Sizing:** Each task should be ~2-4 hours of work
**Dependencies:** Clearly mark which tasks must be done first
**Test Ratio:** Each implementation task should have 2-3x test code compared to implementation
**Documentation:** Every code example should be runnable and tested

### Critical Requirements

✅ Each task is INDEPENDENT (can be picked up by different developers/agents)
✅ Each task includes BOTH implementation AND test requirements
✅ All edge cases from patient-data-update-feature.md are covered
✅ Test cases are specific, not generic (actual values, not placeholders)
✅ Tasks follow TDD approach (tests guide implementation)
✅ Tasks reference the original feature document by section
✅ Code templates are complete and copy-paste ready

### Begin Now

Start with reading `patient-data-update-feature.md`, then proceed through all steps sequentially. 
When complete, provide a summary showing:
- Total tasks created
- Task distribution by complexity
- Estimated total effort (hours)
- Critical path (what must be done first)
- File locations created


How to Use This Prompt
Option 1: Direct Claude Code Execution
1. Copy the entire prompt above
2. Paste into Claude Code chat
3. Wait for task plan generation

Option 2: Save and Reference
Save as: project-root/prompts/planning-agent-prompt.txt
Then use: "Execute the prompt from prompts/planning-agent-prompt.txt"


What This Prompt Will Generate
DeliverablePurposetask-plan-patient-update.mdMaster task list with all detailstask-pack-1-[name].md through task-pack-N-[name].mdCopy-paste ready individual task packstest-strategy-patient-update.mdComplete testing strategyDependency diagramVisual execution orderTask matrix tableQuick reference for all tasks

Sample Task Structure (What You'll Get)
markdownDownloadCopy code## Task 1: PatientDateValidator Component
**Priority:** Critical
**Complexity:** Medium
**Depends On:** None
**Est. Hours:** 3

### Implementation
Create `src/validators/patient-date-validator.js`

### Tests (Minimum 6 test cases)
- Should validate ISO 8601 format
- Should reject invalid dates
- Should reject future dates
- Should handle null/undefined
- Should handle timezone offsets
- Should validate leap years

### Acceptance Criteria
- [ ] Function returns { isValid, date, error }
- [ ] 100% test coverage
- [ ] JSDoc comments included

Pro Tips for Better Results

1. 
Before running the prompt, ensure:

patient-data-update-feature.md is complete and approved ✓ (you have this)
Your project's testing framework is clear (Jest/Mocha/Vitest)
Your Node.js version and dependencies are documented


2. 
Add this customization to the prompt if you want TypeScript:
All code examples should be in TypeScript with proper type definitions.
Test files should use @types/jest for type safety.


3. 
For Agile teams, add:
Format task complexity as Story Points: 1, 2, 3, 5, 8
Include Sprint assignment recommendations


4. 
For distributed teams, add:
For each task, specify: Required knowledge, Recommended pair programming, Time zone considerations



Would you like me to customize this further for your specific:

* Testing framework (Jest/Mocha/Vitest)?
* Tech stack (TypeScript/JavaScript)?
* Team structure (individual/pair/group)?
* Agile methodology (Scrum/Kanban)?