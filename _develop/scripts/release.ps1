Remove-Item -Path ".release" -Recurse -Force
Remove-Item -Path "dist" -Recurse -Force
New-Item -ItemType Directory -Path ".release"
New-Item -ItemType Directory -Path ".release\quill"

npm run build
npx webpack --config "_develop\webpack.config.js" --env minimize
Copy-Item "dist\quill.min.js.LICENSE.txt", "dist\quill.min.js", "dist\quill.min.js.map" -Destination ".release\quill"

Set-Location -Path ".release"