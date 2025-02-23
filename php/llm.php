<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>File Explorer</title>
	<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet"
	      integrity="sha384-1BmE4kWBq78iYhFldvKuhfTAU6auU8tT94WrHftjDbrCEXSU1oBoqyl2QvZ6jIW3" crossorigin="anonymous">
	<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/js/bootstrap.bundle.min.js"
	        integrity="sha384-ka7Sk0Gln4gmtz2MlQnikT1wXgYsOg+OMhuP+IlRH9sENBO0LRn5q+8nbTov4+1p"
	        crossorigin="anonymous"></script>

	<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css" rel="stylesheet">
	<script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
	<style>
      .folder, .file {
          cursor: pointer;
      }

      .folder::before {
          content: "\f07b";
          font-family: "Font Awesome 5 Free";
          margin-right: 5px;
      }

      .folder.open::before {
          content: "\f07c";
      }

      .file::before {
          content: "\f15b";
          font-family: "Font Awesome 5 Free";
          margin-right: 5px;
      }

      .checkbox-wrapper {
          display: inline-block;
          width: 20px;
      }

      #file-tree {
          height: 80vh;
          max-height: 80vh;
          overflow: auto;
          border: 1px solid #ccc;
      }

      #selected-content {
          border: 1px solid #ccc;
          height: 80vh;
          max-height: 80vh;
          width: 100%;
      }

      .folder-star {
          cursor: pointer;
          color: #ccc;
          margin-right: 5px;
      }

      .folder-star.favorite {
          color: gold;
      }

      body.dark-mode { background-color: #333; color: #fff; }
      body.dark-mode #file-tree, body.dark-mode #selected-content { border-color: #555; background-color: #444; color: #fff; }
      body.dark-mode .nav-link { color: #fff; }
      body.dark-mode .btn-outline-primary { color: #fff; border-color: #fff; }
      body.dark-mode .btn-outline-primary:hover { background-color: #0d6efd; color: #fff; }
      body.dark-mode .fs-4 { color: #fff; }

	</style>
</head>
<body>

<div class="container mt-2">
	<header class="d-flex flex-wrap justify-content-center py-3 mb-4 border-bottom">
		<a href="/" class="d-flex align-items-center mb-3 mb-md-0 me-md-auto text-dark text-decoration-none">
			<svg class="bi me-2" width="40" height="32">
				<use xlink:href="#bootstrap"></use>
			</svg>
			<span class="fs-4">LLM Prompt Builder</span>
		</a>

		<ul class="nav nav-pills">
			<li class="nav-item me-2">
				<button id="toggle-favorites" class="btn btn-outline-primary">Show Favorites Only</button>
			</li>
			<li class="nav-item">
				<button id="toggle-mode" class="btn btn-outline-primary">
					<i class="fas fa-sun"></i>
				</button>
			</li>
		</ul>
	</header>

	<div class="row">
		<div class="col-5">
			<div id="file-tree"></div>
		</div>
		<div class="col-7">
			<textarea id="selected-content"></textarea>
		</div>
	</div>
</div>


<script>
	let showFavoritesOnly = false;
	let favorites = JSON.parse(localStorage.getItem('favorites')) || [];
	if (favorites.length > 0) {
		showFavoritesOnly = true;
	}

	function saveState() {
		const openFolders = [];
		$('.folder.open').each(function () {
			openFolders.push($(this).data('path'));
		});
		localStorage.setItem('openFolders', JSON.stringify(openFolders));

		const selectedItems = [];
		$('input[type="checkbox"]:checked').each(function () {
			selectedItems.push({
				path: $(this).data('path'),
				name: $(this).data('name')
			});
		});
		localStorage.setItem('selectedItems', JSON.stringify(selectedItems));
	}

	function restoreState() {
		const openFolders = JSON.parse(localStorage.getItem('openFolders')) || [];

		// Sort the openFolders array by path length (shortest to longest)
		openFolders.sort((a, b) => a.split('/').length - b.split('/').length);

		function openFolder(path) {
			return new Promise((resolve) => {
				const folderElement = $(`.folder[data-path="${path}"]`);
				if (folderElement.length && !folderElement.hasClass('open')) {
					folderElement.addClass('open');
					loadFolders(path, folderElement).then(() => {
						resolve();
					});
				} else {
					resolve();
				}
			});
		}

		async function openFoldersSequentially() {
			for (const path of openFolders) {
				await openFolder(path);
			}
		}

		openFoldersSequentially().then(() => {
			restoreCheckedStates(true);
		});
	}

	function restoreCheckedStates(updateContent = false) {
		const selectedItems = JSON.parse(localStorage.getItem('selectedItems')) || [];
		selectedItems.forEach(function (item) {
			console.log('item with name', item);
			$(`input[type="checkbox"][data-path="${item.path}"][data-name="${item.name}"]`).prop('checked', true);
		});
		if (updateContent) {
			updateSelectedContent();
		}
	}

	function updateSelectedContent() {
		var selectedContent = '';
		var currentFile = '';
		var addedWholeFiles = '';
		$('input[type="checkbox"]:checked').each(function () {
			var path = $(this).attr('data-path');
			var name = $(this).attr('data-name');
			console.log('path', path, 'name', name);

			if (name === 'full_file') {
				// This is a file checkbox
				$.ajax({
					url: 'file_explorer.php',
					method: 'POST',
					data: {action: 'get_file_content', path: path, 'source': 'updateSelectedContent'},
					success: function (response) {
						var data = JSON.parse(response);
						addedWholeFiles += path;
						selectedContent += path + ':\n\n' + data.content + '\n\n';
						$('#selected-content').val(selectedContent);
					}
				});
			} else {
				// This is a child item checkbox

				if (addedWholeFiles.indexOf(path) === -1) {

					if (path !== currentFile) {
						currentFile = path;
						// selectedContent += path + ':\n\n';
					}
					$.ajax({
						url: 'file_explorer.php',
						method: 'POST',
						data: {action: 'get_selected_content', path: path, name: name},
						success: function (response) {
							var data = JSON.parse(response);
							selectedContent += data.path + ':\n\n' + data.content + '\n\n';
							$('#selected-content').val(selectedContent);
						}
					});
				}
			}
		});
	}

	function isPathOrParentFavorite(path) {
		if (favorites.includes(path)) return true;

		const parts = path.split('/');
		for (let i = 1; i < parts.length; i++) {
			const parentPath = parts.slice(0, i).join('/');
			if (favorites.includes(parentPath)) return true;
		}
		return false;
	}

	function loadFolders(path, element) {
		return new Promise((resolve, reject) => {
			const selectedItems = JSON.parse(localStorage.getItem('selectedItems')) || [];
			$.ajax({
				url: 'file_explorer.php',
				method: 'POST',
				data: {
					action: 'get_folders',
					path: path
				},
				success: function (response) {
					var data = JSON.parse(response);
					var ul = $('<ul>').addClass('list-unstyled ms-4').hide();
					data.folders.forEach(function (folder) {
						const fullPath = path === '.' ? folder : path + '/' + folder;
						if (!showFavoritesOnly || isPathOrParentFavorite(fullPath)) {
							ul.append(
								$('<li>').append(
									$('<i>').addClass('fas fa-star folder-star' + (favorites.includes(fullPath) ? ' favorite' : ''))
								).append(
									$('<span>').addClass('folder').text(folder).attr('data-path', fullPath)
								)
							);
						}
					});
					data.files.forEach(function (file) {
						ul.append(
							$('<li>').append(
								$('<div>').addClass('checkbox-wrapper').append(
									$('<input>').addClass('full-file').attr({
										type: 'checkbox',
										'data-path': path + '/' + file,
										'data-name': 'full_file'
									})
								)
							).append(
								$('<span>').attr({'data-path': path + '/' + file, 'data-name': 'full_file'}).addClass('file').text(file)
							)
						);
					});
					if (element) {
						element.after(ul);
						ul.slideDown(200);
					} else {
						$('#file-tree').html(ul);
						ul.show();
					}
					data.files.forEach(function (file) {
						let item_found = false;
						selectedItems.forEach(function (item) {
							if (item.path === path + '/' + file) {
								item_found = true;
							}
						});

						if (item_found) {
							console.log('restoring file state', path + '/' + file);
							loadFileContents(path + '/' + file, $('.file[data-path="' + path + '/' + file + '"]'), true);
						}
					});

					if (!element) {
						setTimeout(() => {
							restoreCheckedStates(true);
							resolve();
						}, 200);
					} else {
						resolve();
					}
				},
				error: function (xhr, status, error) {
					reject(error);
				}
			});
		});
	}

	function loadFileContents(path, element, restore_checked_state = false) {
		console.log('loading file contents', path, element);
		$.ajax({
			url: 'file_explorer.php',
			method: 'POST',
			data: {action: 'get_file_contents', path: path},
			success: function (response) {
				var data = JSON.parse(response);
				var ul = $('<ul>').addClass('list-unstyled ms-4').hide();

				data.items.forEach(function (item) {
					ul.append(
						$('<li>').append(
							$('<div>').addClass('checkbox-wrapper').append(
								$('<input>').addClass('file-function').attr({
									type: 'checkbox',
									'data-path': path,
									'data-name': item.name
								})
							)
						).append(
							$('<span>').text(item.name)
						)
					);
				});

				element.after(ul);
				ul.slideDown(200);
				if (restore_checked_state) {
					restoreCheckedStates(true);
				}
			}
		});
	}


	$(document).ready(function () {

		loadFolders('.', null).then(() => {
			restoreState();
		});

		$('#toggle-favorites').click(function () {
			showFavoritesOnly = !showFavoritesOnly;
			$(this).text(showFavoritesOnly ? 'Show All Folders' : 'Show Favorites Only');
			loadFolders('.', null);
			saveState();
		});

		$('#toggle-mode').click(function() {
			$('body').toggleClass('dark-mode');
			$(this).find('i').toggleClass('fa-sun fa-moon');
			localStorage.setItem('darkMode', $('body').hasClass('dark-mode'));
		});

		if (localStorage.getItem('darkMode') === 'true') {
			$('body').addClass('dark-mode');
			$('#toggle-mode').find('i').removeClass('fa-sun').addClass('fa-moon');
		}

		$(document).on('click', '.folder-star', function (e) {
			e.stopPropagation();
			const path = $(this).next('.folder').data('path');
			const index = favorites.indexOf(path);
			if (index === -1) {
				favorites.push(path);
				$(this).addClass('favorite');
			} else {
				favorites.splice(index, 1);
				$(this).removeClass('favorite');
			}
			localStorage.setItem('favorites', JSON.stringify(favorites));
			saveState();
		});

		$(document).on('click', '.folder', function (e) {
			e.stopPropagation();
			var path = $(this).data('path');
			var $this = $(this);

			if ($this.hasClass('open')) {
				$this.removeClass('open');
				$this.next('ul').slideUp(200);
			} else {
				$this.addClass('open');
				if ($this.next('ul').length) {
					$this.next('ul').slideDown(200);
				} else {
					loadFolders(path, $this);
				}
			}
			saveState();
		});

		$(document).on('click', '.file', function (e) {
			e.stopPropagation();
			var path = $(this).attr('data-path');
			var $this = $(this);

			if ($this.hasClass('open')) {
				$this.removeClass('open');
				$this.next('ul').slideUp(200);
			} else {
				$this.addClass('open');
				if ($this.next('ul').length) {
					$this.next('ul').slideDown(200);
				} else {
					loadFileContents(path, $this, false);
				}
			}
			saveState();
		});

		$(document).on('change', 'input[type="checkbox"]', function (e) {
			e.stopPropagation();
			var isChecked = $(this).prop('checked');
			$(this).prop('checked', isChecked);

			if ($(this).hasClass('file-function')) {
				$('input[type="checkbox"][data-path="' + $(this).data('path') + '"][data-name="full_file"]').prop('checked', false);
			}
			if ($(this).hasClass('full-file')) {
				$('input[type="checkbox"][data-path="' + $(this).data('path') + '"]').prop('checked', false);
				$(this).prop('checked', isChecked);
			}

			updateSelectedContent();
			saveState();
		});

	});

</script>
</body>
</html>
