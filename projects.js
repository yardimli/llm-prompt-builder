$(document).ready(function () {
	// --- Dark Mode ---
	function applyDarkMode() {
		const isDarkMode = $('body').hasClass('dark-mode');
		$('#toggle-mode').find('i').toggleClass('fa-sun', !isDarkMode).toggleClass('fa-moon', isDarkMode);
	}
	
	$('#toggle-mode').click(function () {
		$('body').toggleClass('dark-mode');
		const isDarkMode = $('body').hasClass('dark-mode');
		applyDarkMode();
		// NEW: Save dark mode state to the server instead of localStorage
		$.post('/', {action: 'set_dark_mode', isDarkMode: isDarkMode});
	});
	
	// --- Project Logic ---
	function getProjectIdentifier(project) {
		return `${project.rootIndex}_${project.path}`;
	}
	
	// NEW: Function to render the list of projects fetched from the server
	function renderProjectList(projects) {
		const projectsListContainer = $('#projects-list');
		projectsListContainer.empty();
		
		if (!projects || projects.length === 0) {
			projectsListContainer.html('<p class="text-center text-danger">No top-level folders found in your configured root directories.</p>');
			return;
		}
		
		const groupedProjects = projects.reduce((acc, project) => {
			if (!acc[project.rootPath]) {
				acc[project.rootPath] = [];
			}
			acc[project.rootPath].push(project);
			return acc;
		}, {});
		
		for (const rootPath in groupedProjects) {
			projectsListContainer.append(`<h5 class="mt-4 text-muted w-100">${rootPath}</h5>`);
			const row = $('<div class="row"></div>');
			groupedProjects[rootPath].forEach(function (project) {
				// The server now tells us if the project is checked
				const isChecked = project.isChecked;
				const identifier = getProjectIdentifier(project);
				const col = $('<div class="col-12 col-md-6 col-lg-3 mb-3"></div>');
				const item = $(`
                    <div class="project-card form-check p-3 border rounded h-100">
                        <input class="form-check-input" type="checkbox" value="${identifier}" id="proj-${identifier}" ${isChecked ? 'checked' : ''}>
                        <label class="form-check-label" for="proj-${identifier}">
                            ${project.path}
                        </label>
                    </div>
                `);
				// Store the full project object to be used when toggling
				item.find('input').data('project', {rootIndex: project.rootIndex, path: project.path});
				col.append(item);
				row.append(col);
			});
			projectsListContainer.append(row);
		}
	}
	
	// NEW: Function to load all project data from the server
	function loadPageData() {
		$.ajax({
			url: '/',
			method: 'POST',
			data: {action: 'get_projects_page_data'},
			dataType: 'json',
			success: function (response) {
				renderProjectList(response.projects);
			},
			error: function (xhr, status, error) {
				$('#projects-list').html('<p class="text-center text-danger">Error loading project list. Check server logs.</p>');
				console.error("Error fetching projects:", error);
			}
		});
		
		// Also fetch main page data to get dark mode setting
		$.ajax({
			url: '/',
			method: 'POST',
			data: {action: 'get_main_page_data'},
			dataType: 'json',
			success: function (data) {
				if (data.darkMode) {
					$('body').addClass('dark-mode');
				}
				applyDarkMode();
			}
		});
	}
	
	// NEW: Event handler now sends an update to the server on every change
	$(document).on('change', '#projects-list input[type="checkbox"]', function () {
		const projectData = $(this).data('project');
		$.ajax({
			url: '/',
			method: 'POST',
			data: {
				action: 'toggle_project',
				rootIndex: projectData.rootIndex,
				path: projectData.path,
				isSelected: this.checked
			},
			dataType: 'json',
			error: function (xhr, status, error) {
				alert('Failed to save project selection. Please try again.');
				// Revert the checkbox on failure
				$(this).prop('checked', !this.checked);
			}
		});
	});
	
	// Initial Load
	loadPageData();
});
