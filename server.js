const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const https = require('https'); // NEW: For making API requests to OpenRouter.
const Database = require('better-sqlite3');
let config;
try {
	const configFile = fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8');
	config = JSON.parse(configFile);
	config.root_directories = config.root_directories.map(dir => path.isAbsolute(dir) ? dir : path.resolve(__dirname, dir));
} catch (error) {
	console.error('Error loading config file, make sure to copy example-config.json to config.json:', error);
	process.exit(1);
}
const db = new Database(path.join(__dirname, 'llm-helper.sqlite'));
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
    -- NEW: Stores the list of available LLMs from OpenRouter.
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
`);
const initSettingsStmt = db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)");
initSettingsStmt.run('darkMode', 'false');
initSettingsStmt.run('lastSelectedProject', '');
initSettingsStmt.run('lastSelectedLlm', ''); // NEW: Add setting for last selected LLM.

// --- NEW: Helper function to fetch models from OpenRouter ---
async function fetchOpenRouterModels() {
	return new Promise((resolve, reject) => {
		const options = {
			hostname: 'openrouter.ai',
			path: '/api/v1/models',
			method: 'GET',
			headers: {'Accept': 'application/json'}
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

function resolvePath(inputPath, rootIndex) {
	if (rootIndex >= config.root_directories.length) {
		throw new Error("Invalid root directory index.");
	}
	const realRoot = path.resolve(config.root_directories[rootIndex]);
	const fullPath = inputPath === '.' ? realRoot : path.resolve(realRoot, inputPath);
	if (!fullPath.startsWith(realRoot)) {
		if (inputPath === '.' && fullPath === realRoot) {
		} else {
			throw new Error("Invalid path traversal attempt.");
		}
	}
	return fullPath;
}

function getFolders(inputPath, rootIndex) {
	console.log('called getFolders:', inputPath, rootIndex);
	const fullPath = resolvePath(inputPath, rootIndex);
	const folders = [];
	const files = [];
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
					files.push(item);
				}
			}
		}
	} catch (error) {
		console.error(`Error reading directory ${fullPath}:`, error);
		return {folders: [], files: []};
	}
	return {folders, files};
}

function getFileContent(inputPath, rootIndex) {
	console.log('called getFileContent:', inputPath, rootIndex);
	const fullPath = resolvePath(inputPath, rootIndex);
	try {
		const fileContents = fs.readFileSync(fullPath, 'utf8');
		const collapsedContent = fileContents.replace(/\s+/g, ' ');
		return {content: collapsedContent};
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
	return {matchingFiles};
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
					allProjects.push({rootIndex: index, rootPath: rootDir, path: item});
				}
			}
		} catch (error) {
			console.error(`Error reading root directory ${rootDir}:`, error.message);
		}
	});
	return {projects: allProjects};
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
					case 'get_main_page_data': {
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
					case 'get_projects_page_data': {
						const allFolders = getAllTopLevelFolders().projects;
						const savedProjects = db.prepare('SELECT root_index, path FROM projects').all();
						const savedIdentifiers = new Set(savedProjects.map(p => `${p.root_index}_${p.path}`));
						result = {
							projects: allFolders.map(p => ({
								...p,
								isChecked: savedIdentifiers.has(`${p.root_index}_${p.path}`)
							}))
						};
						break;
					}
					case 'toggle_project': {
						const rootIndex = parseInt(postData.get('rootIndex'));
						const projectPath = postData.get('path');
						const isSelected = postData.get('isSelected') === 'true';
						if (isSelected) {
							db.prepare('INSERT OR IGNORE INTO projects (root_index, path) VALUES (?, ?)').run(rootIndex, projectPath);
						} else {
							db.prepare('DELETE FROM projects WHERE root_index = ? AND path = ?').run(rootIndex, projectPath);
						}
						result = {success: true};
						break;
					}
					case 'get_project_state': {
						const rootIndex = parseInt(postData.get('rootIndex'));
						const projectPath = postData.get('projectPath');
						const state = db.prepare('SELECT open_folders, selected_files FROM project_states WHERE project_root_index = ? AND project_path = ?').get(rootIndex, projectPath);
						result = {
							openFolders: state ? JSON.parse(state.open_folders || '[]') : [],
							selectedFiles: state ? JSON.parse(state.selected_files || '[]') : []
						};
						break;
					}
					case 'save_project_state': {
						const rootIndex = parseInt(postData.get('rootIndex'));
						const projectPath = postData.get('projectPath');
						const openFolders = postData.get('openFolders');
						const selectedFiles = postData.get('selectedFiles');
						db.prepare('INSERT OR REPLACE INTO project_states (project_root_index, project_path, open_folders, selected_files) VALUES (?, ?, ?, ?)').run(rootIndex, projectPath, openFolders, selectedFiles);
						db.prepare('UPDATE app_settings SET value = ? WHERE key = ?').run(`${rootIndex}_${projectPath}`, 'lastSelectedProject');
						result = {success: true};
						break;
					}
					case 'set_dark_mode': {
						const isDarkMode = postData.get('isDarkMode') === 'true';
						db.prepare('UPDATE app_settings SET value = ? WHERE key = ?').run(isDarkMode ? 'true' : 'false', 'darkMode');
						result = {success: true};
						break;
					}
					// NEW: Refreshes the LLM list from OpenRouter and stores it in the DB.
					case 'refresh_llms': {
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
						result = {success: true, llms: newLlms};
						break;
					}
					// NEW: Saves the user's selected LLM.
					case 'save_selected_llm': {
						const llmId = postData.get('llmId');
						db.prepare('UPDATE app_settings SET value = ? WHERE key = ?').run(llmId, 'lastSelectedLlm');
						result = {success: true};
						break;
					}
					case 'get_folders':
						result = getFolders(postData.get('path') || '.', parseInt(postData.get('rootIndex') || '0'));
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
				res.writeHead(200, {'Content-Type': 'application/json'});
				res.end(JSON.stringify(result));
			} catch (error) {
				console.error("Error processing POST request:", error);
				res.writeHead(400, {'Content-Type': 'application/json'});
				res.end(JSON.stringify({error: error.message}));
			}
		});
	} else if (req.method === 'GET' && parsedUrl.pathname === '/') {
		fs.readFile('index.html', 'utf8', (err, content) => {
			if (err) {
				res.writeHead(500);
				res.end('Error loading index.html');
				return;
			}
			res.writeHead(200, {'Content-Type': 'text/html'});
			res.end(content);
		});
	} else if (req.method === 'GET' && parsedUrl.pathname === '/projects') {
		fs.readFile('projects.html', 'utf8', (err, content) => {
			if (err) {
				res.writeHead(500);
				res.end('Error loading projects.html');
				return;
			}
			res.writeHead(200, {'Content-Type': 'text/html'});
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
				html: 'text/html', js: 'application/javascript', css: 'text/css', json: 'application/json', txt: 'text/plain',
			};
			res.writeHead(200, {'Content-Type': mimeTypes[ext] || 'application/octet-stream'});
			res.end(content);
		});
	}
});
server.listen(config.server_port, () => {
	console.log(`Server running at http://localhost:${config.server_port}/`);
});
