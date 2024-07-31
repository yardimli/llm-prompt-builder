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
			<li class="nav-item">
				<button id="toggle-favorites" class="btn btn-primary">Show Favorites Only</button>
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
	if (favorites !== []) {
		showFavoritesOnly = true;
	}
	$(document).ready(function () {

		loadFolders('.', true, false, null);

		$('#toggle-favorites').click(function () {
			showFavoritesOnly = !showFavoritesOnly;
			$(this).text(showFavoritesOnly ? 'Show All Folders' : 'Show Favorites Only');
			loadFolders('.', false, false, null);
			saveState();
		});

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
					loadFolders(path, false, false, $this);
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
		openFolders.forEach(function (path) {
			console.log('path', path);
			const folderElement = $(`.folder[data-path="${path}"]`);
			folderElement.addClass('open');
			loadFolders(path, false, true, folderElement);
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
					data: {action: 'get_file_content', path: path, 'source' : 'updateSelectedContent'},
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


	function loadFolders(path = '.', restore_state_flag = false, restore_state_files = false, element) {
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
								$('<input>').addClass('full-file').attr({type: 'checkbox', 'data-path': path + '/' + file, 'data-name': 'full_file'})
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
					if (restore_state_files) {
						console.log('restoring file state', path + '/' + file);
						loadFileContents(path + '/' + file, $('.file[data-path="' + path + '/' + file + '"]'), true);
					}
				});

				if (restore_state_flag) {
					restoreState();
				}
				if (restore_state_files) {
					restoreCheckedStates(true);
				}
			}
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
								$('<input>').addClass('file-function').attr({type: 'checkbox', 'data-path': path, 'data-name': item.name})
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
</script>
</body>
</html>
