const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const https = require('https');
const Database = require('better-sqlite3');

// Global config object, will be populated from the database.
let config = {};
const db = new Database(path.join(__dirname, 'llm-helper.sqlite'));

// --- Database and Config Initialization ---
function initializeDatabaseAndConfig() {
	// Create all tables if they don't exist.
	db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
            root_index INTEGER NOT NULL,
            path TEXT NOT NULL,
            PRIMARY KEY (root_index, path)
        );
        CREATE TABLE IF NOT EXISTS project_states (
            project_root_index INTEGER NOT NULL,
            project_path TEXT NOT NULL,
            open_folders TEXT,
            selected_files TEXT,
            PRIMARY KEY (project_root_index, project_path),
            FOREIGN KEY (project_root_index, project_path) REFERENCES projects(root_index, path) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS file_metadata (
            project_root_index INTEGER NOT NULL,
            project_path TEXT NOT NULL,
            file_path TEXT NOT NULL,
            file_overview TEXT,
            functions_overview TEXT,
            PRIMARY KEY (project_root_index, project_path, file_path)
        );
        CREATE TABLE IF NOT EXISTS llms (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            context_length INTEGER,
            prompt_price REAL,
            completion_price REAL
        );
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        -- NEW: Table to store application configuration instead of config.json
        CREATE TABLE IF NOT EXISTS app_setup (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    `);
	
	// Check if config is already set up.
	const setupCount = db.prepare('SELECT count(*) as count FROM app_setup').get().count;
	if (setupCount === 0) {
		console.log('First run: Initializing default configuration in the database...');
		const defaultConfig = {
			root_directories: JSON.stringify(["path/to/your/first/directory", "c:/myprojects"]),
			allowed_extensions: JSON.stringify(["js", "jsx", "json", "ts", "tsx", "php", "py", "html", "css", "swift", "xcodeproj", "xcworkspace", "storyboard", "xib", "plist", "xcassets", "playground", "cs", "csproj", "htaccess"]),
			excluded_folders: JSON.stringify([".git", ".idea", "vendor", "storage", "node_modules"]),
			server_port: "3000",
			openrouter_api_key: "YOUR_API_KEY_HERE" // NEW: API Key for LLM calls
		};
		const insertStmt = db.prepare('INSERT INTO app_setup (key, value) VALUES (?, ?)');
		const transaction = db.transaction(() => {
			for (const key in defaultConfig) {
				insertStmt.run(key, defaultConfig[key]);
			}
		});
		transaction();
	}
	
	// Load config from DB into the global 'config' object.
	const configRows = db.prepare('SELECT key, value FROM app_setup').all();
	configRows.forEach(row => {
		try {
			// Try to parse values as JSON (for arrays), fallback to string.
			config[row.key] = JSON.parse(row.value);
		} catch (e) {
			config[row.key] = row.value;
		}
	});
	
	// Ensure server_port is a number for the listener.
	config.server_port = parseInt(config.server_port, 10);
	
	// Resolve root directories to absolute paths.
	config.root_directories = config.root_directories.map(dir => path.isAbsolute(dir) ? dir : path.resolve(__dirname, dir));
	console.log('Configuration loaded from database.');
	
	// Initialize app settings (dark mode, last project, etc.)
	const initSettingsStmt = db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)");
	initSettingsStmt.run('darkMode', 'false');
	initSettingsStmt.run('lastSelectedProject', '');
	initSettingsStmt.run('lastSelectedLlm', '');
}

// Run initialization on startup.
initializeDatabaseAndConfig();

// --- Helper function to fetch models from OpenRouter ---
async function fetchOpenRouterModels() {
	return new Promise((resolve, reject) => {
		const options = {
			hostname: 'openrouter.ai',
			path: '/api/v1/models',
			method: 'GET',
			headers: {
				'Accept': 'application/json'
			}
		};
		const req = https.request(options, (res) => {
			let data = '';
			res.on('data', (chunk) => {
				data += chunk;
			});
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

// NEW: Helper function to call an LLM via OpenRouter
async function callLlm(prompt, modelId) {
	if (!config.openrouter_api_key || config.openrouter_api_key === 'YOUR_API_KEY_HERE') {
		throw new Error('OpenRouter API key is not configured. Please add it on the Setup page.');
	}
	
	return new Promise((resolve, reject) => {
		const postData = JSON.stringify({
			model: modelId,
			messages: [{
				role: "user",
				content: prompt
			}],
			response_format: { type: "json_object" } // Ask for JSON output
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
			res.on('data', (chunk) => {
				data += chunk;
			});
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


function resolvePath(inputPath, rootIndex) {
	if (rootIndex >= config.root_directories.length) {
		throw new Error("Invalid root directory index.");
	}
	const realRoot = path.resolve(config.root_directories[rootIndex]);
	const fullPath = inputPath === '.' ? realRoot : path.resolve(realRoot, inputPath);
	if (!fullPath.startsWith(realRoot)) {
		if (inputPath === '.' && fullPath === realRoot) {} else {
			throw new Error("Invalid path traversal attempt.");
		}
	}
	return fullPath;
}

function getFolders(inputPath, rootIndex, projectPath) { // MODIFIED: Added projectPath
	console.log('called getFolders:', inputPath, rootIndex, projectPath);
	const fullPath = resolvePath(inputPath, rootIndex);
	const folders = [];
	const files = [];
	
	// NEW: Get analysis metadata for all files in this project to avoid N+1 queries
	const metadataStmt = db.prepare('SELECT file_path FROM file_metadata WHERE project_root_index = ? AND project_path = ?');
	const analyzedFiles = new Set(metadataStmt.all(rootIndex, projectPath).map(r => r.file_path));
	
	try {
		const items = fs.readdirSync(fullPath);
		for (const item of items) {
			if (item === '.' || item === '..') continue;
			const itemFullPath = path.join(fullPath, item);
			let stats;
			try {
				stats = fs.statSync(itemFullPath);
			} catch (e) {
				console.warn(`Skipping ${itemFullPath}: ${e.message}`);
				continue;
			}
			
			if (stats.isDirectory()) {
				if (!config.excluded_folders.includes(item)) {
					folders.push(item);
				}
			} else if (stats.isFile()) {
				const ext = path.extname(itemFullPath).slice(1);
				let base = path.basename(itemFullPath);
				if (base.startsWith('.')) {
					base = base.slice(1);
				}
				if (config.allowed_extensions.includes(ext) || (ext === '' && config.allowed_extensions.includes(base))) {
					// MODIFIED: Return file object with analysis status
					const relativeFilePath = path.join(inputPath, item).replace(/\\/g, '/');
					const hasAnalysis = analyzedFiles.has(relativeFilePath);
					files.push({
						name: item,
						path: relativeFilePath,
						has_analysis: hasAnalysis
					});
				}
			}
		}
	} catch (error) {
		console.error(`Error reading directory ${fullPath}:`, error);
		return {
			folders: [],
			files: []
		};
	}
	return {
		folders,
		files
	};
}


function getFileContent(inputPath, rootIndex) {
	console.log('called getFileContent:', inputPath, rootIndex);
	const fullPath = resolvePath(inputPath, rootIndex);
	try {
		const fileContents = fs.readFileSync(fullPath, 'utf8');
		const collapsedContent = fileContents.replace(/\s+/g, ' ');
		return {
			content: collapsedContent
		};
	} catch (error) {
		console.error(`Error reading file ${fullPath}:`, error);
		throw new Error(`Could not read file: ${inputPath}`);
	}
}

function searchFiles(startPath, searchTerm, rootIndex) {
	console.log('called searchFiles:', startPath, searchTerm, rootIndex);
	const realRoot = path.resolve(config.root_directories[rootIndex]);
	const absoluteStartPath = resolvePath(startPath, rootIndex);
	const matchingFiles = [];
	const searchLower = searchTerm.toLowerCase();
	
	function searchInDirectory(currentDir) {
		let items;
		try {
			items = fs.readdirSync(currentDir);
		} catch (err) {
			console.warn(`Cannot read directory ${currentDir}: ${err.message}`);
			return;
		}
		for (const item of items) {
			if (item === '.' || item === '..') continue;
			const itemFullPath = path.join(currentDir, item);
			let stats;
			try {
				stats = fs.statSync(itemFullPath);
			} catch (e) {
				console.warn(`Skipping ${itemFullPath}: ${e.message}`);
				continue;
			}
			if (stats.isDirectory()) {
				if (!config.excluded_folders.includes(item)) {
					searchInDirectory(itemFullPath);
				}
			} else if (stats.isFile()) {
				const ext = path.extname(itemFullPath).slice(1);
				if (config.allowed_extensions.includes(ext)) {
					try {
						const content = fs.readFileSync(itemFullPath, 'utf8');
						if (content.toLowerCase().includes(searchLower)) {
							const relativePath = path.relative(realRoot, itemFullPath).replace(/\\/g, '/');
							matchingFiles.push(relativePath);
						}
					} catch (err) {
						console.warn(`Cannot read file ${itemFullPath}: ${err.message}`);
					}
				}
			}
		}
	}
	searchInDirectory(absoluteStartPath);
	return {
		matchingFiles
	};
}

function getAllTopLevelFolders() {
	const allProjects = [];
	config.root_directories.forEach((rootDir, index) => {
		try {
			const items = fs.readdirSync(rootDir);
			for (const item of items) {
				if (item === '.' || item === '..') continue;
				const itemFullPath = path.join(rootDir, item);
				let stats;
				try {
					stats = fs.statSync(itemFullPath);
				} catch (e) {
					continue;
				}
				if (stats.isDirectory() && !config.excluded_folders.includes(item)) {
					allProjects.push({
						rootIndex: index,
						rootPath: rootDir,
						path: item
					});
				}
			}
		} catch (error) {
			console.error(`Error reading root directory ${rootDir}:`, error.message);
		}
	});
	return {
		projects: allProjects
	};
}

const server = http.createServer((req, res) => {
	const parsedUrl = url.parse(req.url, true);
	if (req.method === 'POST') {
		let body = '';
		req.on('data', chunk => {
			body += chunk.toString();
		});
		req.on('end', async () => {
			const postData = new URLSearchParams(body);
			const action = postData.get('action');
			console.log('POST Request Action:', action);
			let result;
			try {
				switch (action) {
					// NEW: Get current setup for the setup page
					case 'get_setup':
					{
						const setupRows = db.prepare('SELECT key, value FROM app_setup').all();
						const currentConfig = {};
						setupRows.forEach(row => {
							try {
								currentConfig[row.key] = JSON.parse(row.value);
							} catch (e) {
								currentConfig[row.key] = row.value;
							}
						});
						const darkMode = db.prepare("SELECT value FROM app_settings WHERE key = 'darkMode'").get().value;
						result = {
							config: currentConfig,
							darkMode: darkMode === 'true'
						};
						break;
					}
					// NEW: Save setup from the setup page
					case 'save_setup':
					{
						const updateStmt = db.prepare('UPDATE app_setup SET value = ? WHERE key = ?');
						const transaction = db.transaction(() => {
							updateStmt.run(postData.get('root_directories'), 'root_directories');
							updateStmt.run(postData.get('allowed_extensions'), 'allowed_extensions');
							updateStmt.run(postData.get('excluded_folders'), 'excluded_folders');
							updateStmt.run(postData.get('server_port'), 'server_port');
							updateStmt.run(postData.get('openrouter_api_key'), 'openrouter_api_key'); // MODIFIED
						});
						transaction();
						// Reload config in memory for subsequent requests (except port)
						initializeDatabaseAndConfig();
						result = {
							success: true
						};
						break;
					}
					case 'get_main_page_data':
					{
						const projects = db.prepare('SELECT root_index as rootIndex, path FROM projects ORDER BY path ASC').all();
						const settings = db.prepare('SELECT key, value FROM app_settings').all();
						const appSettings = settings.reduce((acc, row) => {
							acc[row.key] = row.value;
							return acc;
						}, {});
						const llms = db.prepare('SELECT id, name FROM llms ORDER BY name ASC').all();
						result = {
							projects,
							lastSelectedProject: appSettings.lastSelectedProject || '',
							darkMode: appSettings.darkMode === 'true',
							llms,
							lastSelectedLlm: appSettings.lastSelectedLlm || ''
						};
						break;
					}
					case 'get_projects_page_data':
					{
						const allFolders = getAllTopLevelFolders().projects;
						const savedProjects = db.prepare('SELECT root_index, path FROM projects').all();
						const savedIdentifiers = new Set(savedProjects.map(p => `${p.root_index}_${p.path}`));
						result = {
							projects: allFolders.map(p => ({ ...p,
								isChecked: savedIdentifiers.has(`${p.root_index}_${p.path}`)
							}))
						};
						break;
					}
					case 'toggle_project':
					{
						const rootIndex = parseInt(postData.get('rootIndex'));
						const projectPath = postData.get('path');
						const isSelected = postData.get('isSelected') === 'true';
						if (isSelected) {
							db.prepare('INSERT OR IGNORE INTO projects (root_index, path) VALUES (?, ?)').run(rootIndex, projectPath);
						} else {
							db.prepare('DELETE FROM projects WHERE root_index = ? AND path = ?').run(rootIndex, projectPath);
						}
						result = {
							success: true
						};
						break;
					}
					case 'get_project_state':
					{
						const rootIndex = parseInt(postData.get('rootIndex'));
						const projectPath = postData.get('projectPath');
						const state = db.prepare('SELECT open_folders, selected_files FROM project_states WHERE project_root_index = ? AND project_path = ?').get(rootIndex, projectPath);
						result = {
							openFolders: state ? JSON.parse(state.open_folders || '[]') : [],
							selectedFiles: state ? JSON.parse(state.selected_files || '[]') : []
						};
						break;
					}
					case 'save_project_state':
					{
						const rootIndex = parseInt(postData.get('rootIndex'));
						const projectPath = postData.get('projectPath');
						const openFolders = postData.get('openFolders');
						const selectedFiles = postData.get('selectedFiles');
						db.prepare('INSERT OR REPLACE INTO project_states (project_root_index, project_path, open_folders, selected_files) VALUES (?, ?, ?, ?)').run(rootIndex, projectPath, openFolders, selectedFiles);
						db.prepare('UPDATE app_settings SET value = ? WHERE key = ?').run(`${rootIndex}_${projectPath}`, 'lastSelectedProject');
						result = {
							success: true
						};
						break;
					}
					case 'set_dark_mode':
					{
						const isDarkMode = postData.get('isDarkMode') === 'true';
						db.prepare('UPDATE app_settings SET value = ? WHERE key = ?').run(isDarkMode ? 'true' : 'false', 'darkMode');
						result = {
							success: true
						};
						break;
					}
					case 'refresh_llms':
					{
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
						result = {
							success: true,
							llms: newLlms
						};
						break;
					}
					case 'save_selected_llm':
					{
						const llmId = postData.get('llmId');
						db.prepare('UPDATE app_settings SET value = ? WHERE key = ?').run(llmId, 'lastSelectedLlm');
						result = {
							success: true
						};
						break;
					}
					// NEW: Get analysis data for a single file
					case 'get_file_analysis':
					{
						const rootIndex = parseInt(postData.get('rootIndex'));
						const projectPath = postData.get('projectPath');
						const filePath = postData.get('filePath');
						const data = db.prepare('SELECT file_overview, functions_overview FROM file_metadata WHERE project_root_index = ? AND project_path = ? AND file_path = ?').get(rootIndex, projectPath, filePath);
						result = data || {
							file_overview: null,
							functions_overview: null
						};
						break;
					}
					// NEW: Analyze a file using an LLM
					case 'analyze_file':
					{
						const rootIndex = parseInt(postData.get('rootIndex'));
						const projectPath = postData.get('projectPath');
						const filePath = postData.get('filePath');
						const llmId = postData.get('llmId');
						
						if (!llmId) throw new Error('No LLM selected for analysis.');
						
						const fileContent = getFileContent(filePath, rootIndex).content;
						
						// Prompt 1: Overview
						const overviewPrompt = `Analyze the following file content and provide a response in a single, minified JSON object format. Do not include any text outside of the JSON object. The JSON object should have the following structure: {"overview": "A brief, one-sentence summary of the file's primary purpose.","internal_dependencies": ["list/of/project/files/it/imports/or/requires"],"external_dependencies": ["list/of/external/libraries/or/apis/used"]}\n\nFile Path: ${filePath}\nFile Content:\n---\n${fileContent}\n---`;
						const overviewResult = await callLlm(overviewPrompt, llmId);
						
						// Prompt 2: Functions
						const functionsPrompt = `Analyze the following file content and provide a response in a single, minified JSON object format. Do not include any text outside of the JSON object. The JSON object should have the following structure: {"language": "The primary programming language detected (e.g., 'JavaScript', 'PHP', 'HTML/JS').","functions": [{"name": "functionName","purpose": "A concise description of what the function does.","inputs": "Description of parameters or 'none'.","output": "Description of the return value or 'none'."}],"main_logic": "A summary of the code that runs outside of any function definitions, like initializations or script entry points."}\n\nFile Path: ${filePath}\nFile Content:\n---\n${fileContent}\n---`;
						const functionsResult = await callLlm(functionsPrompt, llmId);
						
						// Save to DB
						db.prepare('INSERT OR REPLACE INTO file_metadata (project_root_index, project_path, file_path, file_overview, functions_overview) VALUES (?, ?, ?, ?, ?)').run(rootIndex, projectPath, filePath, overviewResult, functionsResult);
						
						result = {
							success: true
						};
						break;
					}
					case 'get_folders':
						result = getFolders(postData.get('path') || '.', parseInt(postData.get('rootIndex') || '0'), postData.get('projectPath')); // MODIFIED
						break;
					case 'get_file_content':
						result = getFileContent(postData.get('path'), parseInt(postData.get('rootIndex') || '0'));
						break;
					case 'search_files':
						result = searchFiles(postData.get('folderPath'), postData.get('searchTerm'), parseInt(postData.get('rootIndex') || '0'));
						break;
					default:
						throw new Error(`Unknown action: ${action}`);
				}
				res.writeHead(200, {
					'Content-Type': 'application/json'
				});
				res.end(JSON.stringify(result));
			} catch (error) {
				console.error("Error processing POST request:", error);
				res.writeHead(400, {
					'Content-Type': 'application/json'
				});
				res.end(JSON.stringify({
					error: error.message
				}));
			}
		});
	} else if (req.method === 'GET' && parsedUrl.pathname === '/') {
		fs.readFile('index.html', 'utf8', (err, content) => {
			if (err) {
				res.writeHead(500);
				res.end('Error loading index.html');
				return;
			}
			res.writeHead(200, {
				'Content-Type': 'text/html'
			});
			res.end(content);
		});
	} else if (req.method === 'GET' && parsedUrl.pathname === '/projects') {
		fs.readFile('projects.html', 'utf8', (err, content) => {
			if (err) {
				res.writeHead(500);
				res.end('Error loading projects.html');
				return;
			}
			res.writeHead(200, {
				'Content-Type': 'text/html'
			});
			res.end(content);
		});
	} else if (req.method === 'GET' && parsedUrl.pathname === '/setup') {
		// NEW: Route for setup page
		fs.readFile('setup.html', 'utf8', (err, content) => {
			if (err) {
				res.writeHead(500);
				res.end('Error loading setup.html');
				return;
			}
			res.writeHead(200, {
				'Content-Type': 'text/html'
			});
			res.end(content);
		});
	} else {
		fs.readFile(path.join(__dirname, parsedUrl.pathname), (err, content) => {
			if (err) {
				res.writeHead(404);
				res.end('Not Found');
				return;
			}
			const ext = path.extname(parsedUrl.pathname).slice(1);
			const mimeTypes = {
				html: 'text/html',
				js: 'application/javascript',
				css: 'text/css',
				json: 'application/json',
				txt: 'text/plain',
			};
			res.writeHead(200, {
				'Content-Type': mimeTypes[ext] || 'application/octet-stream'
			});
			res.end(content);
		});
	}
});

server.listen(config.server_port, () => {
	console.log(`Server running at http://localhost:${config.server_port}/`);
});
