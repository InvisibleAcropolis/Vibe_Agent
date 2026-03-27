import { AuthStorage } from "../src/local-coding-agent.js";
import { createWebTools, runWebRead, runWebSearch } from "../src/tools/web-tools.js";

async function main(): Promise<void> {
	const authStorage = AuthStorage.create();
	const apiKey = await authStorage.getApiKey("langsearch");
	if (!apiKey) {
		throw new Error("No langsearch credential found in auth.json and LANGSEARCH_API_KEY is not set.");
	}

	const query = process.argv[2] ?? "OpenAI Responses API";
	const requestedUrl = process.argv[3];
	const toolNames = createWebTools().map((tool) => tool.name).join(", ");
	console.log(`Registered web tools: ${toolNames}`);

	const search = await runWebSearch({
		query,
		count: 3,
		includeSummary: true,
		freshness: "noLimit",
		apiKey,
	});

	console.log("");
	console.log("=== web_search ===");
	console.log(search.text);

	const candidateUrls = requestedUrl ? [requestedUrl] : search.details.results.map((result) => result.url);
	if (candidateUrls.length === 0) {
		console.log("");
		console.log("No URL available to read from the search results.");
		return;
	}

	let lastError: Error | undefined;
	for (const url of candidateUrls) {
		try {
			const read = await runWebRead({
				url,
				maxChars: 4000,
				format: "markdown",
			});

			console.log("");
			console.log(`=== web_read (${url}) ===`);
			console.log(read.text);
			return;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			console.log("");
			console.log(`Skipping ${url}: ${lastError.message}`);
		}
	}

	throw lastError ?? new Error("Unable to read any search result URL.");
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
