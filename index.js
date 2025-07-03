// Global variables to hold the current state.
let currentProject = null; // { rootIndex: number, path: string }
let currentSearchFolderPath = null;
let searchModal = null; // Will be a Bootstrap Modal instance.
let analysisModal = null; // NEW: Bootstrap Modal instance for analysis results.

// --- Utility Functions ---
function showLoading(message = 'Loading...') {
	const indicator = document.getElementById('loading-indicator');
	if (indicator) {
		// Set the message and show the element.
		indicator.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ${message}`;
		indicator.style.display = 'inline-block';
	}
}

function hideLoading() {
	const indicator = document.getElementById('loading-indicator');
	if (indicator) {
		indicator.style.display = 'none';
	}
}

function getParentPath(filePath) {
	if (!filePath || !filePath.includes('/')) return null;
	return filePath.substring(0, filePath.lastIndexOf('/'));
}

function getProjectIdentifier(project) {
	if (!project) return null;
	return `${project.rootIndex}_${project.path}`;
}

function parseProjectIdentifier(identifier) {
	if (!identifier) return null;
	const parts = identifier.split('_');
	return {
		rootIndex: parseInt(parts[0], 10),
		path: parts.slice(1).join('_')
	};
}

// A reusable async function to handle POST requests using fetch.
async function postData(data) {
	const formData = new URLSearchParams();
	for (const key in data) {
		formData.append(key, data[key]);
	}
	const response = await fetch('/', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: formData
	});
	if (!response.ok) {
		// Try to parse a JSON error message from the server, otherwise use status text.
		let errorPayload = {
			error: `Request failed: ${response.statusText}`
		};
		try {
			errorPayload = await response.json();
		} catch (e) {
			// Ignore if response is not JSON
		}
		throw new Error(errorPayload.error);
	}
	return response.json();
}

// --- Project & State Management ---
// Saves the current project state (open folders, selected files) to the server.
function saveCurrentProjectState() {
	if (!currentProject) return;
	const openFolders = Array.from(document.querySelectorAll('#file-tree .folder.open')).map(el => el.dataset.path);
	const selectedFiles = Array.from(document.querySelectorAll('#file-tree input[type="checkbox"]:checked')).map(el => el.dataset.path);
	postData({
		action: 'save_project_state',
		rootIndex: currentProject.rootIndex,
		projectPath: currentProject.path,
		openFolders: JSON.stringify(openFolders),
		selectedFiles: JSON.stringify(selectedFiles)
	}).catch(error => {
		console.error('Failed to save project state:', error);
		// Optionally notify the user that state could not be saved.
	});
}

// Loads a project by fetching its state from the server.
async function loadProject(identifier) {
	const project = parseProjectIdentifier(identifier);
	const fileTree = document.getElementById('file-tree');
	if (!project) {
		fileTree.innerHTML = '<p class="p-3 text-muted">Please select a project.</p>';
		return;
	}
	showLoading(`Loading project "${project.path}"...`);
	currentProject = project;
	document.getElementById('projects-dropdown').value = identifier;
	try {
		// Fetch the project's saved state from the server.
		const savedState = await postData({
			action: 'get_project_state',
			rootIndex: currentProject.rootIndex,
			projectPath: currentProject.path
		});
		// Load the root folder and then restore the full state.
		await loadFolders(currentProject.path, null);
		await restoreState(savedState || {
			openFolders: [],
			selectedFiles: []
		});
	} catch (error) {
		console.error(`Error loading project ${project.path}:`, error);
		alert(`Error loading project. Check console for details.`);
	} finally {
		hideLoading();
	}
}

// --- Core File Tree Logic ---
// Restores the UI state (open folders, checked files) from data fetched from the server.
async function restoreState(state) {
	console.log('Restoring state:', state);
	const pathsToEnsureOpen = new Set(state.openFolders || []);
	(state.selectedFiles || []).forEach(filePath => {
		let parentPath = getParentPath(filePath);
		while (parentPath && parentPath !== currentProject.path) {
			pathsToEnsureOpen.add(parentPath);
			parentPath = getParentPath(parentPath);
		}
	});
	
	const sortedPaths = [...pathsToEnsureOpen].sort((a, b) => a.split('/').length - b.split('/').length);
	
	for (const path of sortedPaths) {
		const folderElement = document.querySelector(`#file-tree .folder[data-path="${path}"]`);
		if (folderElement && !folderElement.classList.contains('open')) {
			folderElement.classList.add('open');
			await loadFolders(path, folderElement);
		}
	}
	
	restoreCheckedStates(state.selectedFiles || []);
	updateSelectedContent();
}

function restoreCheckedStates(selectedFiles) {
	document.querySelectorAll('#file-tree input[type="checkbox"]').forEach(cb => (cb.checked = false));
	selectedFiles.forEach(path => {
		const checkbox = document.querySelector(`#file-tree input[type="checkbox"][data-path="${path}"]`);
		if (checkbox) {
			checkbox.checked = true;
		} else {
			console.warn(`Checkbox not found during restore for path: ${path}`);
		}
	});
}

// Fetches and displays the contents of a folder.
function loadFolders(path, element) {
	return new Promise(async (resolve, reject) => {
		if (!currentProject) return reject(new Error('No project selected'));
		try {
			// MODIFIED: Pass projectPath to get analysis metadata
			const response = await postData({
				action: 'get_folders',
				path: path,
				rootIndex: currentProject.rootIndex,
				projectPath: currentProject.path
			});
			const fileTree = document.getElementById('file-tree');
			if (element) {
				// Remove existing sub-list if it exists.
				const nextUl = element.nextElementSibling;
				if (nextUl && nextUl.tagName === 'UL') {
					nextUl.remove();
				}
			} else {
				fileTree.innerHTML = ''; // Clear the entire tree for root loading.
			}
			
			if (!response || (!response.folders.length && !response.files.length)) {
				if (element) element.classList.remove('open');
				return resolve();
			}
			
			const ul = document.createElement('ul');
			ul.className = 'list-unstyled';
			// Hide by default to avoid flash of unstyled content, will be shown after insertion.
			ul.style.display = 'none';
			
			let content = '';
			response.folders.sort((a, b) => a.localeCompare(b));
			response.files.sort((a, b) => a.name.localeCompare(b.name)); // MODIFIED: Sort by name property
			
			response.folders.forEach(folder => {
				const fullPath = `${path}/${folder}`;
				content += `
                    <li>
                        <span class="folder" data-path="${fullPath}">
                            ${folder}
                            <span class="folder-controls">
                                <i class="fas fa-search folder-search-icon" title="Search in this folder"></i>
                                <i class="fas fa-eraser folder-clear-icon" title="Clear selection in this folder"></i>
                            </span>
                        </span>
                    </li>`;
			});
			
			// MODIFIED: Handle new file object structure and add analysis icon
			response.files.forEach(fileInfo => {
				const analysisIcon = fileInfo.has_analysis ?
					`<i class="fas fa-info-circle analysis-icon" data-path="${fileInfo.path}" title="View Analysis"></i>` :
					'';
				
				content += `
                    <li>
                        <div class="checkbox-wrapper">
                            <input type="checkbox" data-path="${fileInfo.path}">
                        </div>
                        ${analysisIcon}
                        <span class="file" title="${fileInfo.path}">${fileInfo.name}</span>
                    </li>`;
			});
			
			
			ul.innerHTML = content;
			if (element) {
				element.after(ul); // Insert the new list after the folder span.
			} else {
				fileTree.appendChild(ul);
			}
			ul.style.display = 'block'; // Show the new list.
			resolve();
		} catch (error) {
			console.error(`Error loading folders for path ${path}:`, error);
			if (element) element.classList.remove('open');
			reject(error);
		}
	});
}

// Gathers content from all selected files and displays it in the textarea.
async function updateSelectedContent() {
	const checkedBoxes = document.querySelectorAll('#file-tree input[type="checkbox"]:checked');
	const selectedContentEl = document.getElementById('selected-content');
	if (checkedBoxes.length === 0) {
		selectedContentEl.value = '';
		return;
	}
	
	showLoading(`Loading ${checkedBoxes.length} file(s)...`);
	
	const requestPromises = Array.from(checkedBoxes).map(box => {
		const path = box.dataset.path;
		return postData({
			action: 'get_file_content',
			rootIndex: currentProject.rootIndex,
			path: path
		})
			.then(response => `${path}:\n\n${response.content}\n\n`)
			.catch(error => `/* --- ERROR loading ${path}: ${error.message || 'Unknown error'} --- */\n\n`);
	});
	
	try {
		const results = await Promise.all(requestPromises);
		const contentFooter = 'All input is minified. \n' +
			'For output format the output. \n' +
			'For PHP use psr-12 standards.\n' +
			'For javascript use StandardJS but include semicolumns.\n' +
			'For html use W3C standards.\n' +
			'Skip files that dont need to be changed and are provided for reference.\n' +
			'Comment as needed.\n' +
			'Add comments to new lines and modifed sections.\n';
		selectedContentEl.value = results.join('') + contentFooter;
	} catch (error) {
		console.error('Error updating content:', error);
		selectedContentEl.value = '/* --- An unexpected error occurred while loading file contents. --- */';
	} finally {
		hideLoading();
	}
}

// Ensures a file's parent folders are open in the tree.
async function ensureFileIsVisible(filePath) {
	const parts = filePath.split('/');
	let currentPath = parts[0];
	for (let i = 1; i < parts.length - 1; i++) {
		currentPath = `${currentPath}/${parts[i]}`;
		const folderElement = document.querySelector(`#file-tree .folder[data-path="${currentPath}"]`);
		if (folderElement && !folderElement.classList.contains('open')) {
			folderElement.classList.add('open');
			try {
				await loadFolders(currentPath, folderElement);
			} catch (error) {
				console.error(`Failed to open folder ${currentPath} while ensuring visibility`, error);
				return false;
			}
		}
	}
	return true;
}

// --- Document Ready ---
document.addEventListener('DOMContentLoaded', function () {
	searchModal = new bootstrap.Modal(document.getElementById('searchModal'));
	analysisModal = new bootstrap.Modal(document.getElementById('analysisModal')); // NEW: Initialize analysis modal
	
	// Single initialization function to load all data from the server.
	async function initializeApp() {
		try {
			const data = await postData({
				action: 'get_main_page_data'
			});
			
			// 1. Apply Dark Mode from server settings.
			if (data.darkMode) {
				document.body.classList.add('dark-mode');
				document.querySelector('#toggle-mode i').classList.replace('fa-sun', 'fa-moon');
			}
			
			// ADDED: Initialize the LLM selector with data from the server.
			// This function is defined in llm.js and populates the dropdown.
			if (window.llmHelper && typeof window.llmHelper.initializeLlmSelector === 'function') {
				window.llmHelper.initializeLlmSelector(data.llms, data.lastSelectedLlm);
			} else {
				console.error('LLM helper function not found. Ensure llm.js is loaded before index.js.');
			}
			
			// 2. Populate Projects Dropdown.
			const dropdown = document.getElementById('projects-dropdown');
			dropdown.innerHTML = ''; // Clear existing options.
			if (!data.projects || data.projects.length === 0) {
				dropdown.innerHTML = '<option value="">No projects selected</option>';
				document.getElementById('file-tree').innerHTML = '<p class="p-3 text-muted">No projects configured. Please go to "Select Projects" to begin.</p>';
				return;
			}
			data.projects.forEach(project => {
				const identifier = getProjectIdentifier(project);
				const option = document.createElement('option');
				option.value = identifier;
				option.textContent = project.path;
				dropdown.appendChild(option);
			});
			
			// 3. Load the last project used, or the first in the list.
			const lastProjectIdentifier = data.lastSelectedProject;
			if (lastProjectIdentifier && dropdown.querySelector(`option[value="${lastProjectIdentifier}"]`)) {
				await loadProject(lastProjectIdentifier);
			} else if (data.projects.length > 0) {
				const firstProjectIdentifier = getProjectIdentifier(data.projects[0]);
				await loadProject(firstProjectIdentifier);
			}
		} catch (error) {
			console.error('Failed to initialize app:', error);
			alert('Could not load application data from the server. Please ensure the server is running and check the console.');
		}
	}
	
	initializeApp();
	
	// --- Event Listeners ---
	document.getElementById('projects-dropdown').addEventListener('change', function () {
		loadProject(this.value);
	});
	
	document.getElementById('unselect-all').addEventListener('click', function () {
		document.querySelectorAll('#file-tree input[type="checkbox"]').forEach(cb => (cb.checked = false));
		updateSelectedContent();
		saveCurrentProjectState();
	});
	
	document.getElementById('toggle-mode').addEventListener('click', function () {
		document.body.classList.toggle('dark-mode');
		const isDarkMode = document.body.classList.contains('dark-mode');
		this.querySelector('i').classList.toggle('fa-sun');
		this.querySelector('i').classList.toggle('fa-moon');
		postData({
			action: 'set_dark_mode',
			isDarkMode: isDarkMode
		});
	});
	
	// Use event delegation for clicks within the dynamic file tree.
	document.getElementById('file-tree').addEventListener('click', async (e) => {
		const folder = e.target.closest('.folder');
		const searchIcon = e.target.closest('.folder-search-icon');
		const clearIcon = e.target.closest('.folder-clear-icon');
		const analysisIcon = e.target.closest('.analysis-icon'); // NEW: Analysis icon listener
		
		// NEW: Handle analysis icon click
		if (analysisIcon) {
			e.stopPropagation();
			const filePath = analysisIcon.dataset.path;
			const modalTitle = document.getElementById('analysisModalLabel');
			const modalBody = document.getElementById('analysisModalBody');
			
			modalTitle.textContent = `Analysis for ${filePath}`;
			modalBody.innerHTML = '<div class="text-center p-4"><div class="spinner-border" role="status"><span class="visually-hidden">Loading...</span></div></div>';
			analysisModal.show();
			
			try {
				const data = await postData({
					action: 'get_file_analysis',
					rootIndex: currentProject.rootIndex,
					projectPath: currentProject.path,
					filePath: filePath
				});
				
				let bodyContent = '<p>No analysis data found for this file.</p>';
				if (data.file_overview || data.functions_overview) {
					bodyContent = '';
					if (data.file_overview) {
						try {
							const overview = JSON.parse(data.file_overview);
							bodyContent += `<h6>File Overview</h6><pre>${JSON.stringify(overview, null, 2)}</pre>`;
						} catch (err) {
							bodyContent += `<h6>File Overview (Raw)</h6><pre>${data.file_overview}</pre>`;
						}
					}
					if (data.functions_overview) {
						try {
							const functions = JSON.parse(data.functions_overview);
							bodyContent += `<h6>Functions & Logic</h6><pre>${JSON.stringify(functions, null, 2)}</pre>`;
						} catch (err) {
							bodyContent += `<h6>Functions & Logic (Raw)</h6><pre>${data.functions_overview}</pre>`;
						}
					}
				}
				modalBody.innerHTML = bodyContent;
			} catch (error) {
				modalBody.innerHTML = `<p class="text-danger">Error fetching analysis: ${error.message}</p>`;
			}
			return;
		}
		
		if (searchIcon) {
			e.stopPropagation();
			currentSearchFolderPath = searchIcon.closest('.folder').dataset.path;
			document.getElementById('searchModalFolderPath').textContent = currentSearchFolderPath || 'Root';
			searchModal.show();
			return;
		}
		
		if (clearIcon) {
			e.stopPropagation();
			const folderPath = clearIcon.closest('.folder').dataset.path;
			if (!folderPath) return;
			const selector = `input[type="checkbox"][data-path^="${folderPath}/"]`;
			let uncheckCount = 0;
			document.querySelectorAll(selector).forEach(cb => {
				if (cb.checked) {
					cb.checked = false;
					uncheckCount++;
				}
			});
			if (uncheckCount > 0) {
				updateSelectedContent();
				saveCurrentProjectState();
			}
			return;
		}
		
		if (folder) {
			e.stopPropagation();
			const ul = folder.nextElementSibling;
			if (folder.classList.contains('open')) {
				folder.classList.remove('open');
				if (ul) ul.style.display = 'none'; // Simple hide instead of slideUp
				saveCurrentProjectState();
			} else {
				if (ul) {
					folder.classList.add('open');
					ul.style.display = 'block'; // Simple show instead of slideDown
					saveCurrentProjectState();
				} else {
					showLoading('Loading folder...');
					folder.classList.add('open');
					try {
						await loadFolders(folder.dataset.path, folder);
						saveCurrentProjectState();
					} catch (err) {
						folder.classList.remove('open');
					} finally {
						hideLoading();
					}
				}
			}
		}
	});
	
	// Delegated listener for checkbox changes.
	document.getElementById('file-tree').addEventListener('change', (e) => {
		if (e.target.matches('input[type="checkbox"]')) {
			e.stopPropagation();
			updateSelectedContent();
			saveCurrentProjectState();
		}
	});
	
	document.getElementById('searchTermInput').addEventListener('keypress', e => {
		if (e.key === 'Enter') {
			document.getElementById('performSearchButton').click();
		}
	});
	
	document.getElementById('performSearchButton').addEventListener('click', async function () {
		const searchTerm = document.getElementById('searchTermInput').value.trim();
		searchModal.hide();
		if (!searchTerm || !currentSearchFolderPath) return;
		
		showLoading('Searching files...');
		try {
			const response = await postData({
				action: 'search_files',
				folderPath: currentSearchFolderPath,
				searchTerm: searchTerm,
				rootIndex: currentProject.rootIndex
			});
			if (response.matchingFiles && response.matchingFiles.length > 0) {
				let successfulChecks = 0;
				for (const filePath of response.matchingFiles) {
					const isVisible = await ensureFileIsVisible(filePath);
					if (isVisible) {
						const checkbox = document.querySelector(`#file-tree input[type="checkbox"][data-path="${filePath}"]`);
						if (checkbox && !checkbox.checked) {
							checkbox.checked = true;
							successfulChecks++;
						}
					}
				}
				if (successfulChecks > 0) {
					updateSelectedContent();
					saveCurrentProjectState();
					alert(`Selected ${successfulChecks} new file(s) containing "${searchTerm}".`);
				} else {
					alert(`Found files containing "${searchTerm}", but no *new* files were selected.`);
				}
			} else {
				alert(`No files found containing "${searchTerm}" in "${currentSearchFolderPath}".`);
			}
		} catch (error) {
			alert(`Search failed: ${error.message || 'Unknown error'}`);
		} finally {
			hideLoading();
		}
	});
	
	// NEW: Event listener for the Analyze Files button
	document.getElementById('analyze-files').addEventListener('click', async function () {
		const checkedBoxes = Array.from(document.querySelectorAll('#file-tree input[type="checkbox"]:checked'));
		const llmId = document.getElementById('llm-dropdown').value;
		
		if (checkedBoxes.length === 0) {
			alert('Please select at least one file to analyze.');
			return;
		}
		if (!llmId) {
			alert('Please select an LLM from the dropdown to perform the analysis.');
			return;
		}
		
		const totalFiles = checkedBoxes.length;
		let filesAnalyzed = 0;
		let errors = [];
		
		for (let i = 0; i < totalFiles; i++) {
			const checkbox = checkedBoxes[i];
			const filePath = checkbox.dataset.path;
			const fileName = filePath.split('/').pop();
			showLoading(`Analyzing ${i + 1}/${totalFiles}: ${fileName}`);
			
			try {
				await postData({
					action: 'analyze_file',
					rootIndex: currentProject.rootIndex,
					projectPath: currentProject.path,
					filePath: filePath,
					llmId: llmId
				});
				filesAnalyzed++;
				
				// Add the analysis icon to the UI without a full reload
				const fileSpan = checkbox.closest('li').querySelector('.file');
				if (fileSpan && !fileSpan.previousElementSibling.matches('.analysis-icon')) {
					const icon = document.createElement('i');
					icon.className = 'fas fa-info-circle analysis-icon';
					icon.dataset.path = filePath;
					icon.title = 'View Analysis';
					checkbox.parentElement.after(icon);
				}
			} catch (error) {
				console.error(`Failed to analyze ${filePath}:`, error);
				errors.push(`${filePath}: ${error.message}`);
			}
		}
		
		hideLoading();
		let summaryMessage = `Analysis complete. Successfully analyzed ${filesAnalyzed} of ${totalFiles} files.`;
		if (errors.length > 0) {
			summaryMessage += `\n\nErrors occurred for:\n- ${errors.join('\n- ')}\n\nCheck the console for more details.`;
		}
		alert(summaryMessage);
	});
});
