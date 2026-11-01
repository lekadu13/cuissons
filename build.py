import re, sys, pathlib
HERE = pathlib.Path(__file__).resolve().parent
src = (HERE / 'source' / 'cuissons.html').read_text()
src = re.sub(r'<link rel="preconnect"[^>]*>\n', '', src)
src = re.sub(r'<link rel="stylesheet" href="https://fonts.googleapis.com[^>]*>\n', '', src)
src = src.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '')
src = src.replace('--display: "Barlow Condensed", "Arial Narrow", system-ui, sans-serif;',
                  '--display: "Avenir Next Condensed", "Barlow Condensed", "Arial Narrow", system-ui, sans-serif;')
src = src.replace('--body: "Barlow", system-ui,', '--body: system-ui,')
title_end = src.index('</title>') + len('</title>')
head_extra = src[:title_end]
rest = src[title_end:]
# déplace les <meta>/<style> de tête dans <head>
style_end = rest.index('</style>') + len('</style>')
head_rest, body = rest[:style_end], rest[style_end:]
out = ('<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n'
       '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
       '<link rel="manifest" href="manifest.webmanifest">\n'
       '<link rel="apple-touch-icon" href="apple-touch-icon.png">\n'
       '<meta name="apple-mobile-web-app-status-bar-style" content="default">\n'
       + head_extra + head_rest +
       '\n<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)} body{margin:0} [hidden]{display:none!important}</style>\n'
       '<script>window.PDO_STANDALONE = true;</script>\n</head>\n<body>\n' + body + '\n</body>\n</html>\n')
(HERE / 'index.html').write_text(out)
print(len(out))
