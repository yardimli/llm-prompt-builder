const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

let config;
try {
	const configFile = fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8');
	config = JSON.parse(configFile);
	
	// Resolve relative paths in root_directories to absolute paths
	config.root_directories = config.root_directories.map(dir =>
		path.isAbsolute(dir) ? dir : path.resolve(__dirname, dir)
	);
} catch (error) {
	console.error('Error loading config file, make sure to copy example-config.json to config.json:', error);
	process.exit(1);
}


function resolvePath(inputPath, rootIndex) {
	if (rootIndex >= config.root_directories.length) {
		throw new Error("Invalid root directory index.");
	}
	const realRoot = path.resolve(config.root_directories[rootIndex]);
	const fullPath = path.resolve(realRoot, inputPath);
	if (!fullPath.startsWith(realRoot)) {
		throw new Error("Invalid path.");
	}
	return fullPath;
}

function getFolders(inputPath, rootIndex) {
	console.log('called getFolders:', inputPath, rootIndex);
	const fullPath = resolvePath(inputPath, rootIndex);
	console.log(fullPath, inputPath, rootIndex);
	const folders = [];
	const files = [];
	
	const items = fs.readdirSync(fullPath);
	for (const item of items) {
		if (item === '.' || item === '..' || item.startsWith('.')) continue;
		const itemFullPath = path.join(fullPath, item);
		const stats = fs.statSync(itemFullPath);
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
	return { folders, files };
}

function getFileContents(inputPath, rootIndex) {
	console.log('called getFileContents:', inputPath, rootIndex);
	const fullPath = resolvePath(inputPath, rootIndex);
	const extension = path.extname(fullPath).slice(1);
	const contents = [];
	const fileContents = fs.readFileSync(fullPath, 'utf8');
	
	if (extension === 'js' || extension === 'php') {
		const functionRegex = /function\s+(\w+)\s*\([^)]*\)\s*{[^}]*}/g;
		const classRegex = /class\s+(\w+)\s*{[^}]*}/g;
		let match;
		
		while ((match = functionRegex.exec(fileContents)) !== null) {
			contents.push({ name: match[1], content: match[0] });
		}
		
		while ((match = classRegex.exec(fileContents)) !== null) {
			contents.push({ name: match[1], content: match[0] });
		}
	}
	
	if (extension === 'php' || extension === 'html') {
		const divRegex = /<div[^>]*id=["\']([^"\']*)["\'][^>]*>.*?<\/div>/gs;
		let match;
		
		while ((match = divRegex.exec(fileContents)) !== null) {
			contents.push({ name: `Div ID: ${match[1]}`, content: match[0] });
		}
	}
	
	return { items: contents };
}

function getSelectedContent(inputPath, name, rootIndex) {
	console.log('called getSelectedContent:', inputPath, name, rootIndex);
	const fullPath = resolvePath(inputPath, rootIndex);
	const extension = path.extname(fullPath).slice(1);
	const fileContents = fs.readFileSync(fullPath, 'utf8');
	
	if (config.allowed_extensions.includes(extension)) {
		if (name.startsWith('Div ID:')) {
			const divRegex = new RegExp(`<div[^>]*id=["\']${name.slice(8)}["\'][^>]*>.*?<\/div>`, 's');
			const match = fileContents.match(divRegex);
			return match ? { path: inputPath, name, content: match[0].replace(/\s+/g, ' ') } : null;
		} else {
			const regex = new RegExp(`(?:function|class)\\s+${name}\\s*(?:\\([^)]*\\))?\\s*{[^}]*}`, 's');
			const match = fileContents.match(regex);
			return match ? { path: inputPath, name, content: match[0].replace(/\s+/g, ' ') } : null;
		}
	} else {
		return { path: inputPath, name, content: fileContents.replace(/\s+/g, ' ') };
	}
}

function getFileContent(inputPath, rootIndex) {
	console.log('called getFileContent:', inputPath, rootIndex);
	const fullPath = resolvePath(inputPath, rootIndex);
	const fileContents = fs.readFileSync(fullPath, 'utf8');
	return { content: fileContents.replace(/\s+/g, ' ') };
}

function getRootDirectories() {
	return {
		roots: config.root_directories.map((dir, index) => ({
			index,
			path: dir
		}))
	};
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
			const path = postData.get('path');
			const rootIndex = parseInt(postData.get('rootIndex') || '0');
			console.log('action, path and rootIndex:', action, path, rootIndex);
			
			let result;
			try {
				if (action === 'get_roots') {
					result = getRootDirectories();
				} else if (action === 'get_folders') {
					result = getFolders(path, rootIndex);
				} else if (action === 'get_file_contents') {
					result = getFileContents(path, rootIndex);
				} else if (action === 'get_selected_content') {
					const name = postData.get('name');
					result = getSelectedContent(path, name, rootIndex);
				} else if (action === 'get_file_content') {
					result = getFileContent(path, rootIndex);
				}
				
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(result));
			} catch (error) {
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
		res.writeHead(404);
		res.end('Not Found');
	}
});

server.listen(config.server_port, () => {
	console.log(`Server running at http://localhost:${config.server_port}/`);
});
