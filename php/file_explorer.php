<?php

	$config = [
		'root_directory' => '/var/www/html',
	];

	$rootDirectory = $config['root_directory'];

	function resolvePath($path, $rootDirectory)
	{
		$realRoot = realpath($rootDirectory);
		$fullPath = realpath($rootDirectory . '/' . $path);
		if (strpos($fullPath, $realRoot) !== 0) {
			throw new Exception("Invalid path.");
		}
		return $fullPath;
	}

	function getFolders($path, $rootDirectory)
	{
		$fullPath = resolvePath($path, $rootDirectory);
		$folders = [];
		$files = [];
		$allowedExtensions = ['js', 'php', 'py', 'html', 'css'];
		$excludedFolders = ['vendor', 'storage', 'node_modules'];
		$items = scandir($fullPath);
		foreach ($items as $item) {
			if ($item === '.' || $item === '..' || substr($item, 0, 1) === '.') continue;
			$itemFullPath = $fullPath . '/' . $item;
			if (is_dir($itemFullPath)) {
				if (!in_array($item, $excludedFolders)) {
					$folders[] = $item;
				}
			} elseif (is_file($itemFullPath)) {
				$extension = pathinfo($itemFullPath, PATHINFO_EXTENSION);
				if (in_array($extension, $allowedExtensions)) {
					$files[] = $item;
				}
			}
		}
		return ['folders' => $folders, 'files' => $files];
	}

	function getFileContents($path, $rootDirectory)
	{
		$fullPath = resolvePath($path, $rootDirectory);
		$extension = pathinfo($fullPath, PATHINFO_EXTENSION);
		$contents = [];
		$fileContents = file_get_contents($fullPath);

		if ($extension === 'js') {
			preg_match_all('/function\s+(\w+)\s*\([^)]*\)\s*{[^}]*}/', $fileContents, $matches, PREG_SET_ORDER);
			foreach ($matches as $match) {
				$contents[] = ['name' => $match[1], 'content' => $match[0]];
			}

			preg_match_all('/class\s+(\w+)\s*{[^}]*}/', $fileContents, $matches, PREG_SET_ORDER);
			foreach ($matches as $match) {
				$contents[] = ['name' => $match[1], 'content' => $match[0]];
			}
		} elseif ($extension === 'php') {
			preg_match_all('/function\s+(\w+)\s*\([^)]*\)\s*{[^}]*}/', $fileContents, $matches, PREG_SET_ORDER);
			foreach ($matches as $match) {
				$contents[] = ['name' => $match[1], 'content' => $match[0]];
			}

			preg_match_all('/class\s+(\w+)\s*{[^}]*}/', $fileContents, $matches, PREG_SET_ORDER);
			foreach ($matches as $match) {
				$contents[] = ['name' => $match[1], 'content' => $match[0]];
			}

			preg_match_all('/<div[^>]*id=["\']([^"\']*)["\'][^>]*>.*?<\/div>/s', $fileContents, $matches, PREG_SET_ORDER);
			foreach ($matches as $match) {
				$contents[] = ['name' => "Div ID: {$match[1]}", 'content' => $match[0]];
			}

		} elseif ($extension === 'html') {
			preg_match_all('/<div[^>]*id=["\']([^"\']*)["\'][^>]*>.*?<\/div>/s', $fileContents, $matches, PREG_SET_ORDER);
			foreach ($matches as $match) {
				$contents[] = ['name' => "Div ID: {$match[1]}", 'content' => $match[0]];
			}
		}

		return ['items' => $contents];
	}

	function getSelectedContent($path, $name, $rootDirectory)
	{
		$fullPath = resolvePath($path, $rootDirectory);

		$extension = pathinfo($fullPath, PATHINFO_EXTENSION);
		$fileContents = file_get_contents($fullPath);

		if ($extension === 'js' || $extension === 'php' || $extension === 'html') {
			if (strpos($name, 'Div ID:') === 0) {
				preg_match('/<div[^>]*id=["\']' . substr($name, 8) . '["\'][^>]*>.*?<\/div>/s', $fileContents, $match);
				return ['path' => $path, 'name' => $name, 'content' => preg_replace('/\s+/', ' ', $match[0])];
			} else {
				preg_match('/(?:function|class)\s+' . preg_quote($name) . '\s*(?:\([^)]*\))?\s*{[^}]*}/s', $fileContents, $match);
				return ['path' => $path, 'name' => $name, 'content' => preg_replace('/\s+/', ' ', $match[0])];
			}
		} else {
			return ['path' => $path, 'name' => $name, 'content' => preg_replace('/\s+/', ' ', $fileContents)];
		}
	}

	function getFileContent($path, $rootDirectory)
	{
		$fullPath = resolvePath($path, $rootDirectory);
		$fileContents = file_get_contents($fullPath);

		return ['content' => preg_replace('/\s+/', ' ', $fileContents)];
	}


	if ($_SERVER['REQUEST_METHOD'] === 'POST') {
		$action = $_POST['action'];
		$path = $_POST['path'];
		if ($action === 'get_folders') {
			echo json_encode(getFolders($path, $rootDirectory));
		} elseif ($action === 'get_file_contents') {
			echo json_encode(getFileContents($path, $rootDirectory));
		} elseif ($action === 'get_selected_content') {
			$name = $_POST['name'];
			echo json_encode(getSelectedContent($path, $name, $rootDirectory));
		} elseif ($action === 'get_file_content') {
			echo json_encode(getFileContent($path, $rootDirectory));
		}
	}
