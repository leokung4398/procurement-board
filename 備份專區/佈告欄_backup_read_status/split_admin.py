import re

def extract_and_split_admin(filename, out_css, out_js):
    with open(filename, 'r', encoding='utf-8') as f:
        content = f.read()

    # Extract Style
    style_match = re.search(r'<style>(.*?)</style>', content, re.DOTALL)
    if style_match:
        with open(out_css, 'w', encoding='utf-8') as f:
            f.write(style_match.group(1).strip())
        content = content[:style_match.start()] + f'  <link rel="stylesheet" href="css/{out_css.split("/")[-1]}">\n' + content[style_match.end():]

    # Extract all Script tags that don't have a 'src' attribute
    script_matches = list(re.finditer(r'<script>((?!src=).*?)</script>', content, re.DOTALL))
    
    js_content = []
    
    # Iterate backwards so we can replace safely without messing up indices
    for match in reversed(script_matches):
        js_content.append(match.group(1).strip())
        content = content[:match.start()] + content[match.end():]
        
    js_content.reverse() # put them in the correct order
    
    with open(out_js, 'w', encoding='utf-8') as f:
        f.write('\n\n'.join(js_content))

    # Insert script src right before closing body
    content = content.replace('</body>', f'  <script src="js/{out_js.split("/")[-1]}"></script>\n</body>')
    
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(content)

print("Splitting admin.html...")
extract_and_split_admin('admin.html', 'css/admin.css', 'js/admin.js')
print("Done.")
