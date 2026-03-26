### **P3-P4 \- PLAN**

### 

### **Phase 3: LangGraph Orchestrator Instantiation**

With the communication protocol and multiplexed environment stabilized, the master LangGraph engine can be safely constructed. The core Orc orchestrator will be initialized using the create\_deep\_agent function derived from the DeepAgents library.1 The crucial SubAgentMiddleware will be configured and injected into the pipeline to bind the dynamic task tool directly to the Orc master prompt, providing the mechanism for fleet spawning.13 The engineering team will define the explicit TypedDict structures representing the master state of the graph, ensuring that the state seamlessly incorporates routing logic for the long-term memory backends (such as the Filesystem or Milvus vector database integrations) required by the Archivist.13 Checkpointers will be initialized as MemorySaver instances to guarantee state persistence across thread interruptions.

### **Phase 4: Guild Specialization and Strict Contract Enforcement**

The final, most critical phase involves programming the rigid Chain of Custody for the subagent nodes, ensuring that the mathematical isolation of the architecture is never compromised. The engineering team will define specific, highly constrained LangChain tools (for example, limiting lsp\_hover strictly to the Scout, and edit\_file\_lines strictly to the Mechanic) and bind them exclusively to their respective compiled sub-graphs.1 Extensive prompt engineering will be required to inject constrained system prompts into each subgraph, effectively "brainwashing" the agents into adopting their specific personas (e.g., enforcing an adversarial, paranoid mindset for the Inquisitor, and a high-level, abstract mindset for the Architect).1 Finally, strict Pydantic schemas will be enforced for all inter-agent data contracts. The Recon\_Report, Structural\_Blueprint, and Failure\_Dossier objects will be validated automatically by the runtime, guaranteeing that data traversing the LangGraph nodes is syntactically and logically flawless before the next agent in the sequence is permitted to execute its logic.1

The transition of the Vibe\_Agent to this execution architecture represents a fundamental maturation from a basic, conversational coding assistant into a highly deterministic, autonomous software engineering factory. By encapsulating the runtime within a native psmux multiplexer, the system achieves the capacity to execute, display, and manage autonomous tasks concurrently across highly resilient, persistent terminal panes without the severe latency or compatibility constraints of secondary Linux subsystems. Concurrently, the integration of DeepAgents and LangGraph subgraphs provides the mathematical isolation required to combat context degradation and token bloat. Through the relentless, programmatic enforcement of the Chain of Custody—routing predictably from the Architect to the Scout, the Mechanic to the Inquisitor, and the Warden to the Scribe—the Orc coordinator guarantees that highly complex, multi-layered directives are achieved via localized, intensely specialized intelligence. This multiplexed, state-driven architecture ensures that the agentic execution loops remain targeted, the resulting codebase remains pristine and heavily documented, and the human developer remains fully informed and in control through the synchronized, visual telemetry of the Vibe Curator.

## 

## **The Guild: Chain of Custody and Expertise Enforcement**

The OrcPlan outline dictates a highly structured Chain of Custody to manage the inherent chaos of autonomous software development.1 Tasks are not haphazardly assigned to generalist models; they flow through a rigid, sequential pipeline of specialized domain experts. This sequential routing enforces rigid contracts—meaning an agent is computationally blocked from beginning its work unless it receives the appropriately formatted JSON schema output from the preceding agent in the pipeline.1

The execution plan for implementing the nine distinct members of the subagent guild requires the precise configuration of their LangChain tools, persona-driven system prompts, and LangGraph integration patterns to ensure absolute adherence to their defined roles.

### **1\. The Architect (Systems & Structure)**

The Architect represents the genesis node for any major feature implementation or architectural shift within the Vibe\_Agent ecosystem. Its cognitive focus is entirely restricted to high-level system design, structural robustness, and interface type safety.1

The operational objective of the Architect is to define the scaffolding and interfaces of a project before a single line of operational logic is written.1 To enforce this, the Architect is equipped with a highly constrained toolset consisting only of create\_type\_definitions, scaffold\_directory\_tree, and generate\_data\_models.1 It is explicitly denied access to any tool that can edit operational file lines, physically forcing the language model to remain at the architectural abstraction layer.

Upon receiving a high-level directive from Orc, the Architect analyzes the requirements and drafts core header files, interface definitions (e.g., TypeScript .d.ts files, Rust traits), and directory hierarchies.1 The node executes its planning and terminates by producing a Structural\_Blueprint JSON object.1 This specific Pydantic-validated JSON object acts as the strict data contract that must be completely fulfilled before the system permits the Mechanic to commence implementation.

### **2\. The Scout (Reconnaissance Expert)**

The Scout operates as the navigational intelligence and spatial awareness module of the guild. In modern, highly coupled codebases, allowing an agent to blindly search the filesystem and edit files simultaneously leads to catastrophic overwrites and logic destruction due to regular expression failures or outdated context. The Scout solves this by completely decoupling the discovery phase from the mutation phase.1

The operational objective of the Scout is to meticulously map the territory of the codebase, analyze data flows across multiple modules, and identify exactly where logic must be inserted or modified.1 The Scout relies heavily on the capabilities of the Language Server Protocol (LSP). Its tightly bound toolkit includes lsp\_hover, lsp\_get\_references, and read\_file\_chunk.1 The system prompt explicitly brainwashes the Scout to understand that it is a pure reconnaissance unit fundamentally incapable of writing or fixing code.

When Orc needs to understand how a specific component functions across the repository, it summons the Scout. The Scout traverses the Abstract Syntax Tree (AST), pulls references across multiple interdependent files, and reads the necessary contextual chunks to build a map of the logic.1 The execution loop yields a Recon\_Report JSON.1 This data structure contains absolute file paths, specific line number ranges, and highly targeted semantic descriptions of the logic required at those exact coordinates, serving as the laser-targeting coordinates for the downstream implementer.

### **3\. The Mechanic (Surgical Execution)**

The Mechanic acts as the primary operational vector of the guild. It is the "blue-collar worker" tasked exclusively with actualizing the logic demanded by the Structural\_Blueprint and targeted by the Recon\_Report.1 By the time the Mechanic is invoked, all high-level architectural planning and geographical searching have been conclusively completed by the preceding agents, leaving the Mechanic with a singular, undistracted focus: surgical code insertion.

The operational objective is to write, modify, and compile functional code logic based on the explicit, pre-defined coordinates.1 The Mechanic is provided with a strictly functional toolset containing edit\_file\_lines and run\_linter\_diagnostics.1

The Mechanic's workflow is governed by an iterative, self-correcting LangGraph adversarial loop. After applying the required file edits via its toolset, the state graph transitions automatically to a distinct Verify node within the subgraph.1 This verification node executes language-specific diagnostics (e.g., tsc for TypeScript projects, cargo check for Rust, or flake8 for Python). If the Verify node detects syntax errors or linter warnings, the state routes back to the Mechanic, appending the raw error logs to its context. The Mechanic is explicitly programmed to "argue with the compiler," iteratively attempting to resolve the diagnostic failures up to three consecutive times.1 If the error persists beyond this rigid threshold, the subgraph gracefully halts, packages the failure state, and returns the context to Orc, requesting human intervention to prevent infinite loop token burn.

### **4\. The Inquisitor (Testing & Edge Cases)**

The Inquisitor provides a necessary adversarial counterbalance to the Mechanic, aggressively preventing the deployment of fragile, unverified, or superficially functional code.1

The operational objective of the Inquisitor is to relentlessly hunt for edge cases, unhandled exceptions, and null pointer dereferences that the Mechanic may have overlooked in its pursuit of simple compilation.1 The Inquisitor's tool constraints include write\_unit\_tests, run\_test\_suite, and generate\_mock\_payloads.1

Once the Mechanic successfully bypasses the Verify node, the compiled code is handed directly to the Inquisitor. Operating under a system prompt that enforces the persona assumption that all newly written code is inherently flawed, the Inquisitor designs aggressive unit tests and synthetic mock data payloads intended to break the logic.1 If a test fails, the Inquisitor generates a structured Failure\_Dossier JSON detailing the exact edge case, the stack trace, and the input payload, routing this dossier back to the Mechanic to force a rewrite.1 Orc only receives a final completion signal once the Inquisitor achieves a passing state across the entire adversarial test suite.

### **5\. The Warden (Environment & Dependency Manager)**

Autonomous software development frequently stalls not due to syntactic logic errors, but due to severe environment misconfigurations, missing peer dependencies, and versioning conflicts. The Warden is designed specifically to govern the external borders of the application and maintain environment stability.1

The operational objective is to ensure the security and functionality of the build environment by managing configuration files and dependencies independently of the coding agents.1 The Warden's tools include read\_package\_json (or equivalent manifests like cargo.toml or requirements.txt), check\_dependency\_versions, and manage\_env\_vars.1

The Warden acts as an asynchronous interceptor within the state graph. If the Mechanic's Verify node fails specifically due to a "module not found" exception, an unresolved import, or a dependency resolution error, the routing engine diverts the state immediately to the Warden rather than forcing the Mechanic to solve an environment issue.1 The Warden analyzes the required dependency, updates the relevant manifest file, executes the necessary package installation command, validates the environment, and routes the state back to the Mechanic to cleanly retry the compilation.1

### **6\. The Alchemist (Refactoring & Optimization)**

The Alchemist operates entirely independently of feature creation, acting strictly as a post-implementation code optimization and refinement engine.1

The operational objective is to transmute functioning but chaotic code into elegant, highly performant, and token-efficient logic.1 Its tool constraints are analytical, utilizing analyze\_cyclomatic\_complexity, suggest\_refactor, and lint\_for\_style.1

The Alchemist is invoked periodically or upon specific request by Orc to analyze target files after they have passed the Inquisitor's tests. It adheres strictly to Don't Repeat Yourself (DRY) principles, deploying static analysis to identify redundant loops, deeply nested conditionals, and sub-optimal data structures.1 It rewrites the code to enhance elegance and execution speed without altering the underlying input-output behavior validated by the test suite.

### **7\. The Scribe (Documentation & Translation)**

To mitigate the pervasive issue of documentation rot in rapidly iterating AI-driven codebases, the Scribe guarantees that the repository remains permanently readable and understandable for human developers.1

The operational objective is to translate complex operational logic into clear, maintainable documentation.1 The Scribe utilizes generate\_docstrings, update\_readme\_md, and extract\_public\_api.1

Before Orc marks any major task as finalized, the Abstract Syntax Tree of the final implementation is routed directly to the Scribe. The Scribe reads the final implementation, generates detailed inline comments explaining the logic, formats proper, specification-compliant docstrings for all public interfaces and classes, and appends a comprehensive summary of the newly implemented feature to the project's primary README or architectural wiki.1

### **8\. The Archivist (Vector Memory Expert)**

The Archivist manages the temporal continuity of the Vibe\_Agent, providing vital access to historical context that exceeds the immediate conversation window or the limitations of the standard prompt context.1

The operational objective is to master the vector database and retrieve relevant historical data efficiently.1 Its tool constraints revolve around database interaction, utilizing query\_milvus (or alternative vector databases) and summarize\_historical\_context.1

When a user or the Orc agent issues a vague query (e.g., referencing a utility function built several weeks prior), the Archivist translates the natural language into highly optimized semantic search embeddings.1 It executes the query against the vector database, utilizes a secondary LLM pass to filter out irrelevant noise from the results, and provides Orc with a highly compressed, factual summary of the historical code snippets required for the current task, drastically reducing the token overhead of context retrieval.1

### **9\. The Vibe Curator (TUI & State Manager)**

While all other agents in the guild manipulate files, logic, and infrastructure, the Vibe Curator strictly manipulates the user experience, bridging the critical gap between autonomous, silent execution and human observability.1

The operational objective is to monitor the continuous telemetry of the guild and manage the textual user interface (TUI) state dynamically.1 Its tool constraints are bound to visual output, utilizing emit\_tui\_signal and update\_theme\_colors.1

Running as a parallel observer process, the Vibe Curator intercepts the RPC event stream (turn\_start, tool\_execution\_update) emitted by the pi-mono backend.5 Based on the velocity, state transitions, and success rate of the active agents, it triggers ASCII animations and visual state changes within the psmux terminal panes. For instance, if the Mechanic enters its error-resolution loop and begins failing, the Curator emits a 🔥 signal, instructing the frontend to render an animated "Doom Fire" effect. Upon successful resolution by the Mechanic or Inquisitor, the Curator transitions the UI telemetry to a calm "Water Ripple" (🌊) state, ensuring the human developer maintains an intuitive understanding of the system's operational health.1

| Guild Subagent | Primary Persona & Focus | Core Restricted Toolset | Inter-Agent Data Contract |
| :---- | :---- | :---- | :---- |
| **Architect** | High-level system design, interfaces, and structural robustness. | scaffold\_directory\_tree, create\_type\_definitions | Outputs Structural\_Blueprint JSON. |
| **Scout** | Geographical mapping, AST traversal, data flow analysis. | lsp\_hover, read\_file\_chunk | Outputs Recon\_Report JSON. |
| **Mechanic** | Surgical code insertion, compilation, linter resolution. | edit\_file\_lines, run\_linter\_diagnostics | Requires Recon\_Report; Outputs compiled code. |
| **Warden** | Dependency management, environment stability, configurations. | read\_package\_json, manage\_env\_vars | Intercepts module errors; Outputs environment state. |
| **Inquisitor** | Adversarial testing, edge case hunting, exception handling. | write\_unit\_tests, run\_test\_suite | Outputs Failure\_Dossier or validation signal. |
| **Alchemist** | Code elegance, cyclomatic complexity reduction, DRY enforcement. | suggest\_refactor, analyze\_cyclomatic\_complexity | Outputs optimized codebase modules. |
| **Scribe** | Human-readable documentation, docstring generation, README updates. | generate\_docstrings, update\_readme\_md | Outputs public API specifications. |
| **Archivist** | Long-term temporal memory, vector embeddings, historical context. | query\_milvus, summarize\_historical\_context | Outputs compressed historical summaries. |
| **Vibe Curator** | User experience, telemetry monitoring, TUI state management. | emit\_tui\_signal, update\_theme\_colors | Outputs visual ASCII/ANSI state representations. |

### 

### 

#### **Works cited**

1. OrcPlan.md  
2. psmux/psmux: Tmux on Windows Powershell \- tmux for PowerShell, Windows Terminal, cmd.exe. Includes psmux, pmux, and tmux commands. This is native Powershell Tmux designed for Windows in Rust \- GitHub, accessed March 24, 2026, [https://github.com/psmux/psmux](https://github.com/psmux/psmux)  
3. github.com, accessed March 24, 2026, [https://github.com/InvisibleAcropolis/Vibe\_Agent/tree/main/src/orchestration](https://github.com/InvisibleAcropolis/Vibe_Agent/tree/main/src/orchestration)  
4. pi-mono/packages/coding-agent/README.md at main \- GitHub, accessed March 24, 2026, [https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md)  
5. Terminal Multiplexer for Microsoft Windows \- Installers for GNU Screen or tmux \[closed\], accessed March 24, 2026, [https://stackoverflow.com/questions/5473384/terminal-multiplexer-for-microsoft-windows-installers-for-gnu-screen-or-tmux](https://stackoverflow.com/questions/5473384/terminal-multiplexer-for-microsoft-windows-installers-for-gnu-screen-or-tmux)  
6. psmux/README.md at master \- GitHub, accessed March 24, 2026, [https://github.com/marlocarlo/psmux/blob/master/README.md](https://github.com/marlocarlo/psmux/blob/master/README.md)  
7. r/CLI \- PSMUX \- Tmux for Powershell, the only Terminal Multiplexer you need for Windows, accessed March 24, 2026, [https://www.reddit.com/r/CLI/comments/1qz637t/psmux\_tmux\_for\_powershell\_the\_only\_terminal/](https://www.reddit.com/r/CLI/comments/1qz637t/psmux_tmux_for_powershell_the_only_terminal/)  
8. Command-line interface — list of Rust libraries/crates // Lib.rs, accessed March 24, 2026, [https://lib.rs/command-line-interface](https://lib.rs/command-line-interface)  
9. oh-my-claude-sisyphus \- NPM, accessed March 24, 2026, [https://www.npmjs.com/package/oh-my-claude-sisyphus](https://www.npmjs.com/package/oh-my-claude-sisyphus)  
10. PSMUX: Native tmux for PowerShell — split panes, sessions, detach/attach — no WSL needed \- Reddit, accessed March 24, 2026, [https://www.reddit.com/r/PowerShell/comments/1r1b26l/psmux\_native\_tmux\_for\_powershell\_split\_panes/](https://www.reddit.com/r/PowerShell/comments/1r1b26l/psmux_native_tmux_for_powershell_split_panes/)  
11. pi-mono/packages/coding-agent/docs/rpc.md at main \- GitHub, accessed March 24, 2026, [https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md)  
12. DeepAgents Tutorial: Build Production AI Agents (LangChain) \- byteiota, accessed March 24, 2026, [https://byteiota.com/deepagents-tutorial-build-production-ai-agents-langchain/](https://byteiota.com/deepagents-tutorial-build-production-ai-agents-langchain/)  
13. middleware | deepagents | LangChain Reference, accessed March 24, 2026, [https://reference.langchain.com/javascript/deepagents/middleware](https://reference.langchain.com/javascript/deepagents/middleware)  
14. langchain-ai/deepagentsjs: Deep Agents in JS \- GitHub, accessed March 24, 2026, [https://github.com/langchain-ai/deepagentsjs](https://github.com/langchain-ai/deepagentsjs)  
15. psmux \- crates.io: Rust Package Registry, accessed March 24, 2026, [https://crates.io/crates/psmux/0.1.0](https://crates.io/crates/psmux/0.1.0)  
16. agent | deepagents \- LangChain Reference Docs, accessed March 24, 2026, [https://reference.langchain.com/javascript/deepagents/agent](https://reference.langchain.com/javascript/deepagents/agent)