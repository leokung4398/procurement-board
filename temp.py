import sys
content = open(r'C:\Leo的資料\專案開發\採購佈告欄\js\admin.js', 'r', encoding='utf-8').read()

target = '''    if (selectedEmails.length > 0 && typeof emailjs !== 'undefined') {
      const toList = selectedEmails.join(',');'''

replacement = '''    if (selectedEmails.length > 0 && typeof emailjs !== 'undefined') {
      const emailRecipients = selectedEmails.filter(email => {
        const w = S.whitelist.find(x => x.email === email);
        return !w || w.receiveEmail !== false;
      });
      const toList = emailRecipients.join(',');'''

if target in content:
    content = content.replace(target, replacement)
    
    # We should also wrap emailjs.send in a check if toList is not empty
    target2 = '''      await emailjs.send(emailjsConfig.serviceId, emailjsConfig.templateId, {
        to_email: toList,'''
    replacement2 = '''      if (toList) {
        await emailjs.send(emailjsConfig.serviceId, emailjsConfig.templateId, {
          to_email: toList,'''
    content = content.replace(target2, replacement2)
    
    target3 = '''        bulletin_link: 'https://leokung4398.github.io/procurement-board/'
      });'''
    replacement3 = '''        bulletin_link: 'https://leokung4398.github.io/procurement-board/'
        });
      }'''
    content = content.replace(target3, replacement3)

    open(r'C:\Leo的資料\專案開發\採購佈告欄\js\admin.js', 'w', encoding='utf-8').write(content)
    print("Replaced!")
else:
    print("Not found! ")
