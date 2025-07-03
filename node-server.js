const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Import modularized functions for better organization
const configManager = require('./node-config');
const llmManager = require('./node-llm');
const projectManager = require('./node-projects');
const fileManager = require('./node-files');

// Initialize database and load configuration on startup
configManager.initializeDatabaseAndConfig();

/**
 * Handles all incoming POST requests by routing them to the correct handler function
 * based on the 'action' parameter in the request body.
 * @param {http.IncomingMessage} req - The request object.
 * @param {http.ServerResponse} res - The response object.
 */
async function handlePostRequest(req, res) {
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
				// --- Config/Setup Actions (from node-config.js) ---
				case 'get_setup':
					result = configManager.getSetupData();
					break;
				case 'save_setup':
					configManager.saveSetupData(postData);
					result = { success: true };
					break;
				case 'set_dark_mode':
					configManager.setDarkMode(postData.get('isDarkMode') === 'true');
					result = { success: true };
					break;
				case 'save_selected_llm':
					configManager.saveSelectedLlm(postData.get('llmId'));
					result = { success: true };
					break;
				case 'get_main_page_data':
					result = configManager.getMainPageData();
					break;
				
				// --- LLM Actions (from node-llm.js) ---
				case 'refresh_llms':
					result = await llmManager.refreshLlms();
					break;
				case 'analyze_file':
					result = await llmManager.analyzeFile({
						rootIndex: parseInt(postData.get('rootIndex')),
						projectPath: postData.get('projectPath'),
						filePath: postData.get('filePath'),
						llmId: postData.get('llmId')
					});
					break;
				
				// --- Project Actions (from node-projects.js) ---
				case 'get_projects_page_data':
					result = projectManager.getProjectsPageData();
					break;
				case 'toggle_project':
					result = projectManager.toggleProject({
						rootIndex: parseInt(postData.get('rootIndex')),
						path: postData.get('path'),
						isSelected: postData.get('isSelected') === 'true'
					});
					break;
				case 'get_project_state':
					result = projectManager.getProjectState({
						rootIndex: parseInt(postData.get('rootIndex')),
						projectPath: postData.get('projectPath')
					});
					break;
				case 'save_project_state':
					result = projectManager.saveProjectState({
						rootIndex: parseInt(postData.get('rootIndex')),
						projectPath: postData.get('projectPath'),
						openFolders: postData.get('openFolders'),
						selectedFiles: postData.get('selectedFiles')
					});
					break;
				
				// --- File Actions (from node-files.js) ---
				case 'get_folders':
					result = fileManager.getFolders(
						postData.get('path') || '.',
						parseInt(postData.get('rootIndex') || '0'),
						postData.get('projectPath')
					);
					break;
				case 'get_file_content':
					result = fileManager.getFileContent(
						postData.get('path'),
						parseInt(postData.get('rootIndex') || '0')
					);
					break;
				case 'search_files':
					result = fileManager.searchFiles(
						postData.get('folderPath'),
						postData.get('searchTerm'),
						parseInt(postData.get('rootIndex') || '0')
					);
					break;
				case 'get_file_analysis':
					result = fileManager.getFileAnalysis({
						rootIndex: parseInt(postData.get('rootIndex')),
						projectPath: postData.get('projectPath'),
						filePath: postData.get('filePath')
					});
					break;
				
				default:
					throw new Error(`Unknown action: ${action}`);
			}
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(result));
		} catch (error) {
			console.error("Error processing POST request:", error);
			res.writeHead(400, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: error.message }));
		}
	});
}

/**
 * Serves a static file from the file system.
 * @param {string} filePath - The path to the file to serve.
 * @param {http.ServerResponse} res - The response object.
 */
function serveStaticFile(filePath, res) {
	const fullPath = path.join(__dirname, filePath);
	const ext = path.extname(filePath).slice(1);
	const mimeTypes = {
		html: 'text/html',
		js: 'application/javascript',
		css: 'text/css',
		json: 'application/json',
		txt: 'text/plain',
	};
	const contentType = mimeTypes[ext] || 'application/octet-stream';
	
	fs.readFile(fullPath, (err, content) => {
		if (err) {
			if (err.code === 'ENOENT') {
				res.writeHead(404);
				res.end('Not Found');
			} else {
				res.writeHead(500);
				res.end('Server Error');
			}
			return;
		}
		res.writeHead(200, { 'Content-Type': contentType });
		res.end(content);
	});
}

// Create the main HTTP server
const server = http.createServer((req, res) => {
	const parsedUrl = url.parse(req.url, true);
	
	if (req.method === 'POST') {
		handlePostRequest(req, res);
	} else if (req.method === 'GET') {
		switch (parsedUrl.pathname) {
			case '/':
				serveStaticFile('index.html', res);
				break;
			case '/projects':
				serveStaticFile('projects.html', res);
				break;
			case '/setup':
				serveStaticFile('setup.html', res);
				break;
			default:
				// Serve other static files like JS, CSS
				serveStaticFile(parsedUrl.pathname, res);
				break;
		}
	} else {
		res.writeHead(405); // Method Not Allowed
		res.end();
	}
});

// Start the server using the port from the loaded configuration
const port = configManager.config.server_port || 3000;
server.listen(port, () => {
	console.log(`Server running at http://localhost:${port}/`);
});
