Phase 1: Terminal Multiplexer Encapsulation and 
Spatial Computing 
The initial phase of the architectural overhaul requires the eradication of the standard, 
single-pane console paradigm. Modern multi-agent frameworks require a spatial terminal 
canvas capable of rendering concurrent operations, similar to the teammate mode 
methodologies observed in sophisticated autonomous coding systems. To achieve this on a 
Windows host environment without incurring the signifcant virtualization overhead and 
flesystem boundary latency inherent to the Windows Subsystem for Linux, the system will 
utilize psmux. 
Native Windows Deployment and ConPTY Integration 
Traditional terminal multiplexers, such as the widely adopted GNU tmux, are fundamentally built 
upon POSIX-compliant assumptions and rely heavily on Unix-style pseudo-terminals and 
socket implementations. Consequently, running these tools on Windows operating systems 
historically required translation layers like Cygwin, MSYS2, or the instantiation of an entire 
Windows Subsystem for Linux virtual machine context. For an agentic application like 
Vibe_Agent, which must aggressively manipulate local host fles, read deep directory trees, and 
execute native Windows binaries, forcing the execution through a WSL boundary introduces 
severe path-resolution complexities, severe performance degradation during rapid fle polling, 
and fragmented continuous integration pipelines. 
To circumvent these architectural botlenecks, the engineering team will standardize on psmux. 
Writen entirely in Rust, psmux is a native Windows terminal multiplexer that bypasses legacy 
emulation by communicating directly with the modern Windows Console Pseudoterminal 
application programming interface.
1
 This native execution ensures that all agentic 
sub-processes spawned within the multiplexer inherit the true Windows host environment 
variables, enabling zero-latency fle system operations and direct access to native local host 
resources without translation overhead.
1 
The deployment of the psmux native binary into the local Windows development environments 
and eventual production distributions will be managed via standard package managers to 
ensure reproducible builds. The Vibe_Agent environment provisioning scripts must be updated 
to automatically invoke native package managers, bypassing any legacy WSL confguration 
steps. The automation logic must probe the host environment and execute either winget install 
psmux utilizing the Windows Package Manager, or cargo install psmux for environments 
prioritizing the Rust toolchain.
1
 This installation compiles and paths three identical binaries 
(psmux, pmux, and tmux), ensuring maximum compatibility with existing orchestration scripts 
that may hardcode the traditional tmux command syntax.
1 
Session Bootstrapping and Persistent Lifecycle Management 
With the multiplexer binary securely provisioned within the host path, the primary Vibe_Agent 
initialization sequence must be completely rewriten to act as a multiplexer orchestrator. 
Currently, invoking the application spawns a standard blocking Node.js or Python process 
within the active terminal window. Moving forward, the launch script must bootstrap a 
detached, named, and persistent multiplexer session upon initialization. 
The entry-point automation script will execute psmux new-session -s vibe_core.
1
 This precise 
command instructs the psmux background daemon to instantiate a new terminal state server 
utilizing the vibe_core identifer. The paramount advantage of this approach is absolute session 
persistence. Deep reasoning loops managed by the LangGraph orchestrator—particularly 
those involving recursive planning, extensive codebase indexing, and multi-turn subagent 
delegation—can run for extended durations. In a traditional console setup, an accidental 
closure of the host terminal window, an unexpected graphical shell crash, or a network 
disconnection during a remote desktop session would immediately send a termination signal to 
the running agent, destroying hours of contextual context and expensive token generation. By 
encapsulating the application within vibe_core, the primary process is wholly detached from 
the graphical window lifecycle. If the presentation layer is destroyed, the background daemon 
continues uninterrupted execution. The engineering team or automated health-check monitors 
can subsequently recover the exact visual and operational state by issuing the psmux atach -t 
vibe_core command.
3 
Automated Spatial Orchestration and Subagent Paning 
The core rationale for implementing a terminal multiplexer is to replicate the automated 
"teammate mode" observed in cuting-edge agent frameworks, enabling true parallel 
observability. The Vibe_Agent orchestration layer must dynamically manipulate the terminal 
space programmatically, completely eliminating the need for manual user intervention 
regarding window management. When the primary LangGraph "Orc" deepagent analyzes an 
overarching user objective and identifes sub-tasks requiring parallel execution or specialized 
toolchains, it spawns distinct subagents. For instance, the orchestrator may activate the 
"Inquisitor" subagent to aggressively traverse the local flesystem and build a vector index of 
the project repository, while simultaneously activating the "Alchemist" subagent to begin 
generating boilerplate code based on previously cached paterns. 
To visually accommodate this concurrency without interleaving standard output 
streams—which would render the terminal completely illegible—the shell automation scripts 
embedded within the Vibe_Agent bridging layer will dynamically issue split-window and 
new-window commands via the psmux command-line interface. The multiplexer provides a 
highly scriptable surface area, natively supporting 76 distinct terminal manipulation commands 
and exposing over 126 programmatic format variables.
1 
The architectural implementation for dynamic pane management follows a strict programmatic 
sequence utilizing precise targeting arguments. 
 
Spatial Orchestration 
Command 
Syntax Formulation  Architectural Function 
and Visual Outcome 
Horizontal Space 
Segregation 
psmux split-window -h -t 
vibe_core 
Generates a side-by-side 
pane division. This is 
strategically utilized for 
comparing code difs, 
allowing the Alchemist 
subagent's generation 
output to stream on the 
right pane while the primary 
orchestrator maintains plan 
visibility on the lef. 
Vertical Space 
Segregation 
psmux split-window -v -t 
vibe_core 
Divides the currently 
targeted pane 
top-to-botom. This is 
heavily utilized for utility 
agents, stacking the 
Inquisitor's rapid, noisy 
flesystem indexing logs 
below the active code 
modifcation window to 
maintain context without 
obscuring prime real estate. 
Pane Identifer Resolution  psmux display-message -p 
'#{pane_id}' 
A critical programmatic 
feedback loop. When a new 
pane is generated, this 
command captures the 
underlying multiplexer's 
unique hexadecimal 
identifer for the new space, 
allowing the bridge process 
to explicitly target it for 
future input injection.
7 
Direct Command Injection  psmux send-keys -t  The execution vector for 
<pane_id> "command" Enter  activating the subagent. 
The bridge injects the 
specifc launch string into 
the newly resolved pane 
identifer, executing the 
isolated agent process 
within its dedicated visual 
boundary.
3 
This automated pane allocation guarantees that the exact moment a distinct subagent is 
activated by the LangGraph orchestrator, a persistent, visually isolated window is rendered 
concurrently. Furthermore, because psmux retains full feature parity with legacy multiplexers 
regarding interactive modes, it natively supports mouse-driven pane resizing and vim-style 
copy bufers. Developers interacting with the Vibe_Agent can seamlessly click and drag pane 
borders to expand the Alchemist's code output or utilize the Ctrl+b [ escape sequence to scroll 
through the Inquisitor's historical search logs without interrupting the broader execution 
swarm.
1 
Phase 2: RPC Decoupling and Telemetry Routing 
While Phase 1 guarantees a robust spatial environment capable of supporting concurrent agent 
execution, deploying traditional interactive command-line interfaces into these panes 
introduces severe limitations. Historically, the underlying pi-mono harness outputs directly to 
the standard output bufer utilizing an interactive text-based user interface composed of ANSI 
escape codes, interactive spinners, and complex terminal repainting logic. This tightly coupled 
presentation layer is fundamentally incompatible with advanced programmatic orchestration, 
as it prevents a centralized monitoring system from parsing the execution state. Phase 2 
demands the absolute decoupling of the processing logic from the presentation layer by 
transitioning to a headless Remote Procedure Call architecture, complemented by a 
sophisticated telemetry routing bridge. 
The Headless RPC Paradigm and Strict JSONL Framing 
To achieve total decoupling, the pi-mono coding agent instances—whether representing the 
primary Orc orchestrator or the delegated Inquisitor and Alchemist subagents—will be 
systematically reconfgured to invoke the --mode rpc command-line fag upon startup. 
Activating this fag permanently disables the interactive standard text-based user interface, 
transitioning the agent into a purely headless state designed specifcally for deep process 
integration.
9
 Within this paradigm, the agent accepts execution instructions as structured 
JSON objects via standard input and emits all system telemetry, conversational updates, and 
tool execution logs as continuous JSON lines via standard output.
9 
This transition introduces rigorous protocol specifcations that the engineering team must 
strictly enforce to ensure system stability. The pi-mono RPC mode relies on absolute, 
LF-delimited JSONL framing. Every emited record is guaranteed to end with a newline 
character, which serves as the sole acceptable delimiter.
11
 A critical, well-documented 
vulnerability exists within standard Node.js integration paterns regarding stream parsing. 
Developers frequently utilize the generic, built-in readline module to ingest standard output 
streams line-by-line. However, the native Node.js readline implementation is fundamentally 
non-compliant with this specifc RPC protocol because it inherently splits string bufers upon 
encountering arbitrary Unicode separators—specifcally the Unicode Line Separator (U+2028) 
and the Unicode Paragraph Separator (U+2029).
11
 Because large language models frequently 
generate these specifc Unicode characters within raw data, markdown formating, or natural 
language reasoning blocks, routing the RPC stream through a standard readline interface will 
inevitably split a single JSON payload into multiple malformed fragments. When the application 
logic subsequently atempts to execute a JSON.parse() operation on these fragments, the 
system will throw a fatal syntax exception, crashing the communication bridge and terminating 
the agent connection.
11 
To mitigate this fatal architectural faw, the engineering team must engineer a custom, 
hardened stream consumer for the Vibe_Agent communication bridge. This low-level bufered 
reader must ingest raw byte chunks from the pi-mono standard output pipe, appending them 
to an internal string bufer, and manually extracting discrete JSON payloads exclusively by 
locating the strict \n byte terminator, systematically ignoring all internal Unicode separators 
until the payload is safely extracted and parsed. 
Constructing the Communication Bridge and Vibe Curator State 
Machine 
The decoupled architecture relies entirely upon a lightweight, highly optimized intermediary 
Node.js or TypeScript process designated as the communication bridge. This process functions 
as the central nervous system of the Vibe_Agent framework, establishing a bi-directional 
conduit between the LangGraph execution graph, the headless pi-mono inference instances, 
and the psmux multiplexer environment. The primary responsibility of this bridge is to ingest 
the continuous, high-throughput JSONL stream emanating from the active RPC engines and 
translate this raw machine telemetry into meaningful operational data. 
Embedded deeply within this communication bridge is the complex logic engine defned as the 
Vibe Curator. The Vibe Curator operates as a deterministic state machine, continuously 
listening to the asynchronous RPC events, maintaining an internal representation of the 
multi-agent swarm's cognitive status, and mapping these precise protocol payloads to visual 
state changes. The pi-mono JSONL protocol exposes a comprehensive suite of discrete 
lifecycle events that the Curator must parse, validate, and react to in real time. 
 
Core RPC Telemetry Event  Vibe Curator Parsing 
Logic and Data Extraction 
Architectural System 
Response Trigger 
agent_start  Marks the defnitive 
initialization of an agentic 
reasoning loop. The Curator 
extracts the target agent 
identifer and timestamps 
the initialization. 
Allocates internal memory 
for a new task state, resets 
associated timeout 
watchdogs, and clears the 
previous visualization bufer 
for the targeted agent.
11 
turn_start  Indicates the beginning of a 
specifc conversational turn 
or the initiation of a discrete 
cognitive cycle before tool 
execution. 
Updates the active status 
indicator within the state 
machine to refect that the 
underlying large language 
model is actively 
processing context and 
consuming inference 
compute.
11 
message_update  Highly frequent streaming 
event containing the 
assistantMessageEvent 
delta. The Curator parses 
the sub-types, 
discriminating between 
text_delta (natural 
language), thinking_delta 
(internal reasoning models), 
and toolcall_delta 
(argument generation).
11 
Pipes the extracted strings 
to specifc formating 
parsers, allowing the 
system to track the agent's 
internal monologue and 
anticipate impending 
flesystem or shell 
commands before they are 
fnalized. 
tool_execution_update  Provides real-time 
streaming deltas regarding 
active tool usage. The 
Curator extracts the 
partialResult feld, which 
contains the completely 
accumulated output of the 
tool execution up to that 
precise millisecond.
11 
Triggers a visual bufer 
replacement. Because the 
payload contains the 
accumulated output rather 
than just a diferential delta, 
the Curator can safely 
overwrite the display array, 
rendering smooth progress 
bars or streaming shell logs. 
agent_end  Signifes the absolute 
completion of the prompt 
execution. The payload 
encapsulates an array of all 
generated AgentMessage 
objects formulated during 
the run.
11 
Finalizes the visual state, 
calculates total execution 
duration, extracts the 
ultimate fnishReason (e.g., 
"stop", "toolUse", "length"), 
and signals the overarching 
LangGraph orchestrator 
that the sub-node 
execution is complete. 
Advanced Telemetry Routing and Asynchronous ASCII Rendering 
The paramount objective of the Vibe Curator is to enforce strict visual hygiene across the 
spatial terminal environment by structurally isolating background state telemetry from 
foreground source code modifcations. In legacy systems, an agent's internal reasoning, fle 
indexing logs, and token consumption statistics are printed sequentially in the exact same 
console window as the generated source code, creating an impenetrable wall of text that 
severely degrades developer comprehension. 
As the Vibe Curator ingests the aforementioned JSONL events and updates its internal state 
machine, it simultaneously maps these state changes into a highly optimized, asynchronous 
ASCII rendering engine. Instead of printing this ASCII output arbitrarily into the active pane 
where source code editing or shell commands are occurring, the Curator utilizes its 
programmatic control over the multiplexer to push these visual updates directly to a dedicated, 
visually distinct status pane within the vibe_core session. 
This routing is achieved by leveraging the psmux inter-process communication mechanisms. 
The Curator can establish a persistent named pipe or rapidly issue psmux send-keys 
commands specifcally targeted at the exact hexadecimal pane_id reserved exclusively for the 
Curator dashboard.
3
 Consequently, the human operator observes a pristine, highly organized 
spatial layout. A dedicated dashboard pane continuously updates with high-level LangGraph 
node transitions, active tool execution progress bars, model reasoning status, and memory 
compaction alerts, while completely separated horizontal and vertical panes display the 
uninterrupted, live source code modifcations executed by the Alchemist or the precise 
directory traversals executed by the Inquisitor. This explicit routing guarantees that visual state 
changes never corrupt the code generation bufers. 
LangGraph Orchestration and DeepAgent Swarm 
Topologies 
The cognitive intelligence driving this spatial and telemetry architecture is the central 
Orchestration system. This system is fundamentally built upon the LangGraph framework, 
heavily augmented by the specialized DeepAgent sofware development kit.
14
 Traditional 
sequential language chains are insufcient for complex sofware engineering tasks; they lack 
the ability to backtrack, maintain durable long-term memory, or gracefully recover from 
execution failures. The LangGraph architecture natively resolves these limitations by modeling 
the entire multi-agent interaction as a cyclical, stateful graph, explicitly enforcing an operational 
loop consisting of precise planning, strategic delegation, and continuous state updating.
15 
The Orc Orchestrator and Hierarchical Planning Middleware 
The primary operational entity within the Vibe_Agent ecosystem is the "Orc" agent, which 
serves as the graph's defnitive entry point and central coordinator. Utilizing the 
DeepAgent.create() application programming interface, the Orc agent is instantiated with 
sophisticated planning middleware and robust flesystem integration explicitly enabled.
14 
A critical vulnerability in standard agentic systems is context window overfow. When an agent 
atempts to hold the entirety of a project's objective, the full conversational history, and vast 
amounts of indexed code within its immediate context, it rapidly approaches the model's token 
limits. This triggers expensive, time-consuming auto_compaction_start and 
auto_compaction_end events, wherein the system is forced to dynamically summarize and 
discard historical interactions to remain operational.
11
 The Orc DeepAgent circumvents this 
fatal degradation by strictly enforcing a write_todos planning patern.
14 
When the Orc agent receives a high-level user directive, it does not immediately begin 
executing code modifcations. Instead, it utilizes the planning middleware to decompose the 
macroscopic goal into a deterministic, hierarchical list of discrete sub-tasks. By forcing the 
language model to repeatedly interact with a dedicated todo tool, the DeepAgent framework 
maintains an explicit, visible task list that tracks overarching progress.
15
 This list is persisted 
outside the immediate token context, allowing the agent to continuously orient itself within 
complex, long-horizon workfows without sufering from cognitive drif or hallucinating 
completed objectives.
15 
Subagent Activation, Delegation, and Filesystem State Persistence 
Once a defnitive plan is established via the write_todos patern, the Orc orchestrator yields 
direct execution and transitions into a supervisory delegation phase. Based on the specifc 
requirements of the current sub-task, the LangGraph routing logic spawns highly specialized 
subagents optimized for narrow operational scopes.
14 
For example, if the active objective requires locating deprecated API calls across a massive 
legacy repository, the Orc agent will instantiate the Inquisitor subagent, equipping it exclusively 
with highly aggressive grep, glob, and fle-reading tools. If the objective requires refactoring a 
specifc TypeScript class, the Alchemist subagent is instantiated with targeted fle-writing and 
bash execution tools. 
The activation of a subagent immediately triggers the Phase 1 and Phase 2 infrastructure. The 
communication bridge detects the LangGraph node transition, dynamically issues the psmux 
split-window command to carve out a new visual pane, and initializes a secondary headless 
pi-mono RPC instance injected with the subagent's specifc system prompt and tool schema.
3 
Crucially, the interaction between the Orc orchestrator and the delegated subagents does not 
occur via massive context transfers or verbose conversational history, which would invariably 
bloat the token stream. Instead, the DeepAgent framework leverages durable flesystem 
middleware to persist knowledge and coordinate state.
14
 Both the parent orchestrator and the 
executing subagents share access to a designated, security-enhanced memory directory.
14 
The delegated subagent executes its specifc toolchain autonomously within its isolated pane. 
Rather than atempting to stream massive arrays of fle contents back through the JSONL 
protocol to the orchestrator, the subagent writes its intermediate fndings, analytical 
summaries, and generated artifacts directly into structured fles within the shared memory 
directory.
15
 Upon successfully concluding its assigned objective, the subagent emits the 
terminal agent_end JSONL payload over its RPC standard output.
11 
The Vibe Curator, continuously monitoring the telemetry stream, detects this termination 
signal. It subsequently issues the command to freeze or gracefully collapse the subagent's 
psmux pane, reads the structured output status from the subagent, and passes the control 
fow back to the primary LangGraph orchestrator. The Orc agent then reads the newly 
populated fles from the shared memory directory, updates its internal write_todos list to mark 
the objective as complete, and evaluates the graph state to determine the next sequential 
action.
15
 This elegant combination of spatial pane isolation, headless RPC telemetry, and 
flesystem-backed graph state allows the Vibe_Agent to solve exponentially larger sofware 
engineering problems while maintaining absolute systemic stability and minimizing context 
window exhaustion. 
System Engineering Specifcations and Target File 
Structure 
To successfully implement this exhaustive architecture, the engineering team must adhere to a 
rigid, highly organized fle structure within the existing 
htps://github.com/InvisibleAcropolis/Vibe_Agent repository. The architecture mandates the 
seamless integration of the imported /resources/pi-mono and /resources/psmux proprietary 
dependencies directly into the core src/orchestration layer, ensuring that all cross-process 
communication paths are defnitively mapped. 
The following table provides the explicit architectural responsibilities and execution contexts 
for every critical component within the desired system topology. 
 
Target Directory / File 
Path 
Core Component 
Designation 
Explicit Architectural 
Responsibility and 
Execution Context 
/resources/psmux/  Rust Multiplexer Binaries  Houses the compiled native 
psmux.exe, pmux.exe, and 
tmux.exe binaries required 
to bootstrap the spatial 
console environment 
directly via the Windows 
ConPTY API, completely 
bypassing WSL 
dependencies.
1 
/resources/pi-mono/  Base AI Agent Toolkit  Contains the foundational 
coding-agent 
dependencies, Unifed LLM 
APIs, and tool execution 
engines. These packages 
will be strictly invoked 
utilizing the --mode rpc 
parameter to enforce 
headless execution.
10 
src/orchestration/bootstrap
.ps1 
Environment Initialization  The primary PowerShell 
launch vector. Responsible 
for executing the initial 
psmux new-session -s 
vibe_core sequence, 
calculating terminal 
dimensions, and 
provisioning the initial 
window layout for both the 
orchestrator and the 
dedicated Curator 
dashboard pane.
3 
src/orchestration/bridge/str
eam_parser.ts 
JSONL Delimiter Logic  The hardened stream 
reader critical for Phase 2. 
Explicitly avoids the native 
Node.js readline 
implementation. 
Implements a low-level 
bufer that splits incoming 
byte payloads strictly on 
the \n LF character to 
categorically prevent 
corruption from 
U+2028/U+2029 Unicode 
separators.
9 
src/orchestration/bridge/cu
rator.ts 
Vibe Curator State Machine  Ingests the safely parsed 
JSON objects from the 
stream reader. Maps 
high-throughput turn_start, 
tool_execution_update, and 
message_update events to 
discrete data structures 
accurately representing the 
multi-agent swarm's 
current cognitive and 
operational status.
11 
src/orchestration/bridge/re
nderer.ts 
ASCII Telemetry Router  Translates the Curator's 
internal state into highly 
formated string bufers 
and pipes them explicitly to 
the dedicated psmux status 
pane utilizing targeted 
send-keys or named pipes, 
ensuring real-time UI 
updates occur without 
interrupting source code 
outputs.
7 
src/orchestration/graph/orc_
agent.ts 
Primary LangGraph 
Orchestrator 
Instantiates the central 
DeepAgent. Manages the 
core node defnitions, 
conditional graph edges, 
and the critical write_todos 
planning middleware 
utilized to orchestrate the 
broader execution cycle 
and task decomposition.
14 
src/orchestration/graph/sub
agents/ 
Specialized Agent 
Defnitions 
A directory containing the 
explicit system prompts, 
tailored model 
confgurations, and strict 
tool restrictions for 
specialized graph delegates 
(e.g., Inquisitor for indexing, 
Alchemist for generation), 
which are dynamically 
spawned into isolated 
psmux panes upon graph 
transitions.
15 
src/orchestration/memory/  Filesystem Middleware 
Target 
The highly secured, 
centralized directory where 
both the primary Orc 
orchestrator and all 
independent subagents 
perform direct fle I/O 
operations to persist 
long-term knowledge, drop 
intermediate artifacts, and 
seamlessly share contextual 
state between isolated 
execution nodes.
15 
 
