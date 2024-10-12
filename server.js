const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const config = {
	//can also set it manually to 'c:/users/locutus-borg/my-projects/' '/home/locutus-borg/my-projects/'
	root_directory: path.resolve(__dirname, '..'),
	server_port : 3000
};

function resolvePath(inputPath, rootDirectory) {
	const realRoot = path.resolve(rootDirectory);
	const fullPath = path.resolve(rootDirectory, inputPath);
	if (!fullPath.startsWith(realRoot)) {
		throw new Error("Invalid path.");
	}
	return fullPath;
}

function getFolders(inputPath, rootDirectory) {
	console.log('called getFolders:', inputPath, rootDirectory);
	const fullPath = resolvePath(inputPath, rootDirectory);
	console.log(fullPath, inputPath, rootDirectory);
	const folders = [];
	const files = [];
	const allowedExtensions = ['js', 'php', 'html', 'css'];
	const excludedFolders = ['vendor', 'storage', 'node_modules'];
	
	const items = fs.readdirSync(fullPath);
	for (const item of items) {
		if (item === '.' || item === '..' || item.startsWith('.')) continue;
		const itemFullPath = path.join(fullPath, item);
		const stats = fs.statSync(itemFullPath);
		if (stats.isDirectory()) {
			if (!excludedFolders.includes(item)) {
				folders.push(item);
			}
		} else if (stats.isFile()) {
			const extension = path.extname(itemFullPath).slice(1);
			if (allowedExtensions.includes(extension)) {
				files.push(item);
			}
		}
	}
	return { folders, files };
}

function getFileContents(inputPath, rootDirectory) {
	console.log('called getFileContents:', inputPath, rootDirectory);
	const fullPath = resolvePath(inputPath, rootDirectory);
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

function getSelectedContent(inputPath, name, rootDirectory) {
	console.log('called getSelectedContent:', inputPath, name, rootDirectory);
	const fullPath = resolvePath(inputPath, rootDirectory);
	const extension = path.extname(fullPath).slice(1);
	const fileContents = fs.readFileSync(fullPath, 'utf8');
	
	if (['js', 'php', 'html'].includes(extension)) {
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

function getFileContent(inputPath, rootDirectory) {
	console.log('called getFileContent:', inputPath, rootDirectory);
	const fullPath = resolvePath(inputPath, rootDirectory);
	const fileContents = fs.readFileSync(fullPath, 'utf8');
	return { content: fileContents.replace(/\s+/g, ' ') };
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
			console.log('action and path:', action, path);
			
			let result;
			if (action === 'get_folders') {
				result = getFolders(path, config.root_directory);
			} else if (action === 'get_file_contents') {
				result = getFileContents(path, config.root_directory);
			} else if (action === 'get_selected_content') {
				const name = postData.get('name');
				result = getSelectedContent(path, name, config.root_directory);
			} else if (action === 'get_file_content') {
				result = getFileContent(path, config.root_directory);
			}
			
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(result));
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
