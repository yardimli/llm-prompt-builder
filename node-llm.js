const https = require('https');
const { db, config } = require('./node-config');
const { getFileContent } = require('./node-files');

/**
 * Fetches the list of available models from the OpenRouter API.
 * @returns {Promise<object>} A promise that resolves to the parsed JSON response from OpenRouter.
 */
async function fetchOpenRouterModels() {
	return new Promise((resolve, reject) => {
		const options = {
			hostname: 'openrouter.ai',
			path: '/api/v1/models',
			method: 'GET',
			headers: { 'Accept': 'application/json' }
		};
		
		const req = https.request(options, (res) => {
			let data = '';
			res.on('data', (chunk) => { data += chunk; });
			res.on('end', () => {
				if (res.statusCode >= 200 && res.statusCode < 300) {
					try {
						resolve(JSON.parse(data));
					} catch (e) {
						reject(new Error('Failed to parse OpenRouter response.'));
					}
				} else {
					reject(new Error(`OpenRouter request failed with status code: ${res.statusCode}`));
				}
			});
		});
		
		req.on('error', (e) => reject(e));
		req.end();
	});
}

/**
 * Calls a specified LLM via the OpenRouter API with a given prompt.
 * @param {string} prompt - The prompt to send to the LLM.
 * @param {string} modelId - The ID of the OpenRouter model to use.
 * @returns {Promise<string>} A promise that resolves to the content of the LLM's response.
 */
async function callLlm(prompt, modelId) {
	if (!config.openrouter_api_key || config.openrouter_api_key === 'YOUR_API_KEY_HERE') {
		throw new Error('OpenRouter API key is not configured. Please add it on the Setup page.');
	}
	
	return new Promise((resolve, reject) => {
		const postData = JSON.stringify({
			model: modelId,
			messages: [{ role: "user", content: prompt }],
			response_format: { type: "json_object" } // Request JSON output
		});
		
		const options = {
			hostname: 'openrouter.ai',
			path: '/api/v1/chat/completions',
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${config.openrouter_api_key}`,
				'Content-Length': Buffer.byteLength(postData)
			}
		};
		
		const req = https.request(options, (res) => {
			let data = '';
			res.on('data', (chunk) => { data += chunk; });
			res.on('end', () => {
				if (res.statusCode >= 200 && res.statusCode < 300) {
					try {
						const responseJson = JSON.parse(data);
						if (responseJson.choices && responseJson.choices.length > 0) {
							resolve(responseJson.choices[0].message.content);
						} else {
							reject(new Error('Invalid response structure from LLM.'));
						}
					} catch (e) {
						reject(new Error('Failed to parse LLM response.'));
					}
				} else {
					reject(new Error(`LLM API request failed with status code: ${res.statusCode}. Response: ${data}`));
				}
			});
		});
		
		req.on('error', (e) => reject(e));
		req.write(postData);
		req.end();
	});
}

/**
 * Refreshes the local list of LLMs from OpenRouter and stores them in the database.
 * @returns {Promise<object>} A promise that resolves to an object containing the new list of LLMs.
 */
async function refreshLlms() {
	const modelData = await fetchOpenRouterModels();
	const models = modelData.data || [];
	
	const insert = db.prepare('INSERT OR REPLACE INTO llms (id, name, context_length, prompt_price, completion_price) VALUES (@id, @name, @context_length, @prompt_price, @completion_price)');
	const transaction = db.transaction((modelsToInsert) => {
		db.exec('DELETE FROM llms');
		for (const model of modelsToInsert) {
			insert.run({
				id: model.id,
				name: model.name,
				context_length: model.context_length,
				prompt_price: parseFloat(model.pricing.prompt),
				completion_price: parseFloat(model.pricing.completion)
			});
		}
	});
	transaction(models);
	
	const newLlms = db.prepare('SELECT id, name FROM llms ORDER BY name ASC').all();
	return { success: true, llms: newLlms };
}

/**
 * Analyzes a single file using two separate LLM calls for overview and function details,
 * then saves the results to the database.
 * @param {object} params - The parameters for the analysis.
 * @param {number} params.rootIndex - The index of the project's root directory.
 * @param {string} params.projectPath - The path of the project.
 * @param {string} params.filePath - The path of the file to analyze.
 * @param {string} params.llmId - The ID of the LLM to use for analysis.
 * @returns {Promise<object>} A promise that resolves to a success object.
 */
async function analyzeFile({ rootIndex, projectPath, filePath, llmId }) {
	if (!llmId) {
		throw new Error('No LLM selected for analysis.');
	}
	const fileContent = getFileContent(filePath, rootIndex).content;
	
	// Prompt 1: File Overview
	const overviewPrompt = `Analyze the following file content and provide a response in a single, minified JSON object format. Do not include any text outside of the JSON object. The JSON object should have the following structure: {"overview": "A brief, one-sentence summary of the file's primary purpose.","internal_dependencies": ["list/of/project/files/it/imports/or/requires"],"external_dependencies": ["list/of/external/libraries/or/apis/used"]}\n\nFile Path: ${filePath}\nFile Content:\n---\n${fileContent}\n---`;
	const overviewResult = await callLlm(overviewPrompt, llmId);
	
	// Prompt 2: Functions and Logic
	const functionsPrompt = `Analyze the following file content and provide a response in a single, minified JSON object format. Do not include any text outside of the JSON object. The JSON object should have the following structure: {"language": "The primary programming language detected (e.g., 'JavaScript', 'PHP', 'HTML/JS').","functions": [{"name": "functionName","purpose": "A concise description of what the function does.","inputs": "Description of parameters or 'none'.","output": "Description of the return value or 'none'."}],"main_logic": "A summary of the code that runs outside of any function definitions, like initializations or script entry points."}\n\nFile Path: ${filePath}\nFile Content:\n---\n${fileContent}\n---`;
	const functionsResult = await callLlm(functionsPrompt, llmId);
	
	// Save results to the database
	db.prepare('INSERT OR REPLACE INTO file_metadata (project_root_index, project_path, file_path, file_overview, functions_overview) VALUES (?, ?, ?, ?, ?)')
		.run(rootIndex, projectPath, filePath, overviewResult, functionsResult);
	
	return { success: true };
}

module.exports = {
	refreshLlms,
	analyzeFile
};
