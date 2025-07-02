const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

let config;
try {
	const configFile = fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8');
	config = JSON.parse(configFile);
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
	const fullPath = inputPath === '.' ? realRoot : path.resolve(realRoot, inputPath);
	
	if (!fullPath.startsWith(realRoot)) {
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

// --- NEW: Get all top-level folders to be used as projects ---
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
					continue; // Skip if cannot stat
				}
				
				if (stats.isDirectory() && !config.excluded_folders.includes(item)) {
					allProjects.push({
						rootIndex: index,
						rootPath: rootDir, // Send the full path for display purposes
						path: item // This is the project name/path
					});
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
		req.on('end', () => {
			const postData = new URLSearchParams(body);
			const action = postData.get('action');
			const requestPath = postData.get('path');
			const rootIndex = parseInt(postData.get('rootIndex') || '0');
			const searchTerm = postData.get('searchTerm');
			const folderPath = postData.get('folderPath');
			console.log('POST Request:', {action, requestPath, rootIndex, searchTerm, folderPath});
			
			let result;
			try {
				if (action === 'get_all_top_level_folders') {
					result = getAllTopLevelFolders();
				} else if (action === 'get_folders') {
					const effectivePath = requestPath || '.';
					result = getFolders(effectivePath, rootIndex);
				} else if (action === 'get_file_content') {
					if (!requestPath) throw new Error("Path is required for get_file_content");
					result = getFileContent(requestPath, rootIndex);
				} else if (action === 'search_files') {
					if (!folderPath) throw new Error("Folder path is required for search");
					if (!searchTerm) throw new Error("Search term is required");
					result = searchFiles(folderPath, searchTerm, rootIndex);
				} else {
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
				html: 'text/html', js: 'application/javascript', css: 'text/css',
				json: 'application/json', txt: 'text/plain',
			};
			res.writeHead(200, {'Content-Type': mimeTypes[ext] || 'application/octet-stream'});
			res.end(content);
		});
	}
});

server.listen(config.server_port, () => {
	console.log(`Server running at http://localhost:${config.server_port}/`);
});
