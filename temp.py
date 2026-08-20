import sys
content = open(r'C:\Leo的資料\專案開發\採購佈告欄\js\admin.js', 'r', encoding='utf-8').read()

target = '''        must_read_text: mustReadText
      });
    }
    
    S.dirty=false;'''

replacement = '''        must_read_text: mustReadText
        });
      }
    }
    
    S.dirty=false;'''

if target in content:
    content = content.replace(target, replacement)
    open(r'C:\Leo的資料\專案開發\採購佈告欄\js\admin.js', 'w', encoding='utf-8').write(content)
    print("Replaced!")
else:
    print("Target not found.")
