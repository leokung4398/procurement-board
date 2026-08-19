
import os
import subprocess
import datetime
import shutil

PROJECT_PATH = r"C:\Leo的資料\專案開發\採購佈告欄"

# 自動尋找 Git 路徑，如果找不到就用預設的
git_path = shutil.which("git") or r"C:\Program Files\Git\cmd\git.exe"

def run_command(command):
    try:
        result = subprocess.run(command, cwd=PROJECT_PATH, shell=True, text=True, capture_output=True)
        if result.returncode == 0:
            print(f"成功: {command}")
            if result.stdout.strip():
                print(result.stdout.strip())
        else:
            print(f"錯誤 ({command}):")
            print(result.stderr.strip())
            if "Authentication failed" in result.stderr or "Permission denied" in result.stderr:
                print("\n【警告】GitHub 驗證失敗！")
                print("這表示您的電腦還沒有授權登入 GitHub。")
                print("系統稍後可能會跳出登入視窗，請依照畫面指示登入您的 GitHub 帳號。")
    except Exception as e:
        print(f"執行失敗: {e}")

def main():
    print("===============================")
    print("   開始自動更新 GitHub ...")
    print("===============================\n")
    os.chdir(PROJECT_PATH)
    
    current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    commit_message = f"自動更新: {current_time}"
    
    # 用雙引號包住 git_path 以防路徑中有空格
    git_cmd = f"\"{git_path}\""
    
    run_command(f"{git_cmd} add .")
    run_command(f"{git_cmd} commit -m \"{commit_message}\"")
    
    print("\n正在將資料上傳到 GitHub，請稍候...")
    print("(如果是第一次執行，可能會跳出瀏覽器要求您登入 GitHub 帳號)\n")
    
    # 這裡直接執行推播
    run_command(f"{git_cmd} push origin main")
    
    print("\n===============================")
    print("✅ 更新流程結束！")
    print("===============================")
    input("請按 Enter 鍵關閉視窗...")

if __name__ == "__main__":
    main()

