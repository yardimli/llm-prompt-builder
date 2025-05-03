const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

let config;
try {
	const configFile = fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8');
	config = JSON.parse(configFile);
	// Resolve relative paths in root_directories to absolute paths
	config.root_directories = config.root_directories.map(dir => path.isAbsolute(dir) ? dir : path.resolve(__dirname, dir));
} catch (error) {
	console.error('Error loading config file, make sure to copy example-config.json to config.json:', error);
	process.exit(1);
}

function resolvePath(inputPath, rootIndex) {
	if (rootIndex >= config.root_directories.length) {
		throw new Error("Invalid root directory index.");
	}
	const realRoot = path.resolve(config.root_directories[rootIndex]);
	// If inputPath is '.', resolve it directly to the root
	const fullPath = inputPath === '.' ? realRoot : path.resolve(realRoot, inputPath);
	
	// Security check: Ensure the resolved path is still within the intended root
	if (!fullPath.startsWith(realRoot)) {
		// Allow the root path itself even if inputPath is '.'
		if (inputPath === '.' && fullPath === realRoot) {
			// This is okay
		} else {
			throw new Error("Invalid path traversal attempt.");
		}
	}
	return fullPath;
}


function getFolders(inputPath, rootIndex) {
	console.log('called getFolders:', inputPath, rootIndex);
	const fullPath = resolvePath(inputPath, rootIndex);
	console.log('getFolders resolved path:', fullPath);
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
				console.warn(`Skipping ${itemFullPath}: ${e.message}`); // Handle potential permission errors etc.
				continue;
			}
			
			
			if (stats.isDirectory()) {
				if (!config.excluded_folders.includes(item)) {
					folders.push(item);
				}
			} else if (stats.isFile()) {
				const extension = path.extname(itemFullPath).slice(1);
				if (config.allowed_extensions.includes(extension)) {
					files.push(item);
				}
			}
		}
	} catch (error) {
		console.error(`Error reading directory ${fullPath}:`, error);
		// Decide if you want to throw or return empty lists
		// throw error; // Option 1: Propagate error
		return { folders: [], files: [] }; // Option 2: Return empty on error
	}
	return { folders, files };
}

function getFileContent(inputPath, rootIndex) {
	console.log('called getFileContent:', inputPath, rootIndex);
	const fullPath = resolvePath(inputPath, rootIndex);
	console.log('getFileContent resolved path:', fullPath);
	try {
		const fileContents = fs.readFileSync(fullPath, 'utf8');
		// --- Add this line back ---
		const collapsedContent = fileContents.replace(/\s+/g, ' ');
		// --- Return the collapsed content ---
		return { content: collapsedContent };
		// Original line (if you prefer raw content):
		// return { content: fileContents };
	} catch (error) {
		console.error(`Error reading file ${fullPath}:`, error);
		throw new Error(`Could not read file: ${inputPath}`);
	}
}
function getRootDirectories() {
	return { roots: config.root_directories.map((dir, index) => ({ index, path: dir })) };
}

// --- NEW: Search Functionality ---
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
			return; // Skip directories we can't read
		}
		
		for (const item of items) {
			if (item === '.' || item === '..' || item.startsWith('.')) continue;
			
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
					searchInDirectory(itemFullPath); // Recurse into subdirectories
				}
			} else if (stats.isFile()) {
				const extension = path.extname(itemFullPath).slice(1);
				if (config.allowed_extensions.includes(extension)) {
					try {
						const content = fs.readFileSync(itemFullPath, 'utf8');
						if (content.toLowerCase().includes(searchLower)) {
							// Store the path relative to the *root* directory
							const relativePath = path.relative(realRoot, itemFullPath).replace(/\\/g, '/'); // Ensure forward slashes
							matchingFiles.push(relativePath);
						}
					} catch (err) {
						console.warn(`Cannot read file ${itemFullPath}: ${err.message}`);
						// Skip files we can't read
					}
				}
			}
		}
	}
	
	searchInDirectory(absoluteStartPath);
	console.log('Found matching files:', matchingFiles);
	return { matchingFiles };
}
// --- End NEW Search Functionality ---

const server = http.createServer((req, res) => {
	const parsedUrl = url.parse(req.url, true);
	
	if (req.method === 'POST') {
		let body = '';
		req.on('data', chunk => {
			body += chunk.toString();
		});
		req.on('end', () => {
			const postData = new URLSearchParams(body);
			const action = postData.get('action');
			const requestPath = postData.get('path'); // Renamed from 'path' to avoid conflict
			const rootIndex = parseInt(postData.get('rootIndex') || '0');
			const searchTerm = postData.get('searchTerm'); // Get search term for the new action
			const folderPath = postData.get('folderPath'); // Get folder path for search
			
			console.log('POST Request:', { action, requestPath, rootIndex, searchTerm, folderPath });
			
			let result;
			try {
				if (action === 'get_roots') {
					result = getRootDirectories();
				} else if (action === 'get_folders') {
					// Ensure requestPath is not null or undefined, default to '.' if necessary
					const effectivePath = requestPath || '.';
					result = getFolders(effectivePath, rootIndex);
				} else if (action === 'get_file_content') {
					if (!requestPath) throw new Error("Path is required for get_file_content");
					result = getFileContent(requestPath, rootIndex);
				} else if (action === 'search_files') { // --- NEW: Handle Search Action ---
					if (!folderPath) throw new Error("Folder path is required for search");
					if (!searchTerm) throw new Error("Search term is required");
					result = searchFiles(folderPath, searchTerm, rootIndex);
				} else {
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
	} else if (req.method === 'GET' && parsedUrl.pathname === '/') {
		console.log('GET /');
		fs.readFile('index.html', 'utf8', (err, content) => {
			if (err) {
				res.writeHead(500);
				res.end('Error loading index.html');
				return;
			}
			res.writeHead(200, { 'Content-Type': 'text/html' });
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
			res.writeHead(200, {'Content-Type': mimeTypes[ext] || 'application/octet-stream'});
			res.end(content);
		});
	}
});

server.listen(config.server_port, () => {
	console.log(`Server running at http://localhost:${config.server_port}/`);
});
