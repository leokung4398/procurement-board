import re

def extract_and_split(filename, out_css, out_js):
    with open(filename, 'r', encoding='utf-8') as f:
        content = f.read()

    # Find the style block
    style_match = re.search(r'<style>(.*?)</style>', content, re.DOTALL)
    if style_match:
        with open(out_css, 'w', encoding='utf-8') as f:
            f.write(style_match.group(1).strip())
        content = content[:style_match.start()] + f'  <link rel="stylesheet" href="css/{out_css.split("/")[-1]}">\n' + content[style_match.end():]

    # Find the script block (we specifically want the main logic script, which is usually the last one, or the one with a lot of content)
    # Since there are multiple scripts (like Tailwind, Firebase), we look for the one containing `const S =` or `let S =`
    scripts = list(re.finditer(r'<script>(.*?)</script>', content, re.DOTALL))
    for s in scripts:
        if 'function' in s.group(1) or 'const S =' in s.group(1) or 'const S=' in s.group(1):
            with open(out_js, 'w', encoding='utf-8') as f:
                f.write(s.group(1).strip())
            content = content[:s.start()] + f'  <script src="js/{out_js.split("/")[-1]}"></script>\n' + content[s.end():]
            break

    with open(filename, 'w', encoding='utf-8') as f:
        f.write(content)

print("Splitting index.html...")
extract_and_split('index.html', 'css/index.css', 'js/index.js')
print("Splitting admin.html...")
extract_and_split('admin.html', 'css/admin.css', 'js/admin.js')
print("Done.")
