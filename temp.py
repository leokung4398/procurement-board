import sys

with open(r'C:\Leo的資料\專案開發\採購佈告欄\index.html', 'r', encoding='utf-8') as f:
    content = f.read()

count = 0
new_content = ""
for line in content.split('\n'):
    if 'ql-editor' in line and 'text-left' not in line:
        line = line.replace('ql-editor', 'ql-editor text-left')
        count += 1
    new_content += line + '\n'

with open(r'C:\Leo的資料\專案開發\採購佈告欄\index.html', 'w', encoding='utf-8') as f:
    f.write(new_content)

print(f"Added text-left to {count} occurrences in index.html")
