# 📬 Smart Email Manager with Telegram & AI

An intelligent email monitoring system that automatically classifies your Gmail emails and sends you smart summaries on Telegram.

**Perfect for:**
- 🎯 Never miss important job offers or recruitment emails
- 🚫 Automatically filter out spam and newsletters
- 🤖 AI-powered classification (optional, free with Groq)
- 📱 Get clean summaries on Telegram

---

## ✨ Features

### **Without AI (Basic Mode)**
- ✅ Keyword-based email classification
- ✅ Automatic spam/newsletter filtering
- ✅ Priority detection (Urgent/Important/Normal)
- ✅ Telegram notifications every 4 hours
- ✅ Works 100% offline (no API needed)

### **With AI (Groq - FREE)**
- ✅ **Intelligent context understanding**
- ✅ **Accurate recruitment email detection**
- ✅ **Smart filtering** (real jobs vs LinkedIn spam)
- ✅ **Explains why** each email was classified
- ✅ **100% FREE** (30 requests/minute limit)

---

## 📋 How It Works

1. **Connects to Gmail** via IMAP every 4 hours
2. **Checks unread emails** (last 30)
3. **Classifies each email**:
   - 🔥 **URGENT**: Deadlines, immediate action needed
   - ⚡ **IMPORTANT**: Job offers, recruitment, interviews
   - 📧 **NORMAL**: Legitimate but not priority
   - 🗑️ **IGNORE**: Spam, newsletters, marketing
4. **Sends summary to Telegram** with smart formatting

---

## 🚀 Quick Start (5 Minutes)

### **Step 1: Clone/Download**
```bash
git clone <your-repo>
cd email-manager
```

### **Step 2: Install Dependencies**
```bash
pip install -r requirements.txt
```

### **Step 3: Configure Gmail**

#### **A. Enable IMAP in Gmail**
1. Go to Gmail → Settings (⚙️) → See all settings
2. Click **Forwarding and POP/IMAP**
3. Enable **IMAP**
4. Click **Save Changes**

#### **B. Create App Password**
1. Go to [Google Account Security](https://myaccount.google.com/security)
2. Enable **2-Step Verification** (if not already)
3. Go to **App passwords** (search for it)
4. Select:
   - App: **Mail**
   - Device: **Other** (type "Email Manager")
5. Click **Generate**
6. **COPY** the 16-character password (format: `xxxx xxxx xxxx xxxx`)

### **Step 4: Configure Telegram**

#### **A. Create a Telegram Bot**
1. Open Telegram and search for **@BotFather**
2. Send: `/newbot`
3. Choose a name: `My Email Manager`
4. Choose a username: `my_email_manager_bot` (must end with "bot")
5. **COPY** the token: `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`

#### **B. Get Your Chat ID**
1. Search for your bot in Telegram
2. Send it a message: `/start`
3. Open in browser: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
   - Replace `<YOUR_BOT_TOKEN>` with your actual token
4. Look for `"chat":{"id":123456789}` in the JSON
5. **COPY** that number (your Chat ID)

### **Step 5: Configure the Application**

Edit `config.py`:

```python
# Configuration Gmail
GMAIL_EMAIL = "your.email@gmail.com"  # ← Your Gmail address
GMAIL_APP_PASSWORD = "xxxx xxxx xxxx xxxx"  # ← App password from Step 3

# Configuration Telegram
TELEGRAM_BOT_TOKEN = "1234567890:ABCdefGHI..."  # ← Bot token from Step 4A
TELEGRAM_CHAT_ID = "123456789"  # ← Chat ID from Step 4B

# Configuration Groq AI (OPTIONAL - see Step 6)
GROQ_API_KEY = ""  # Leave empty for basic mode
USE_AI_CLASSIFICATION = False  # Set to True to enable AI

# Other settings (you can keep defaults)
CHECK_INTERVAL_HOURS = 4
IMAP_SERVER = "imap.gmail.com"
IMAP_PORT = 993
```

### **Step 6 (OPTIONAL): Enable AI Classification**

#### **A. Get Free Groq API Key**
1. Go to [https://console.groq.com](https://console.groq.com)
2. Sign up (free - no credit card needed)
3. Go to **API Keys** in the left menu
4. Click **Create API Key**
5. Give it a name: `Email Manager`
6. **COPY** the key (starts with `gsk_...`)
   - ⚠️ **Save it somewhere safe** - you can't see it again!

#### **B. Install Groq**
```bash
pip install groq
```

#### **C. Update config.py**
```python
GROQ_API_KEY = "gsk_..."  # ← Paste your Groq API key
USE_AI_CLASSIFICATION = True  # ← Enable AI
```

---

## 🎯 Run the Application

### **Test Run (One-time check)**
```bash
python email_manager.py
```

You should see:
```
🚀 Démarrage Email Manager v2
⏰ Vérification toutes les 4 heures
🤖 Classification IA: ACTIVÉE
🔍 Vérification des emails...
📧 15 nouveaux emails trouvés
   🔥 Urgent: 1 | ⚡ Important: 3 | 📧 Normal: 4 | 🗑️ Ignorés: 7
✅ Message envoyé sur Telegram
```

Check your Telegram - you should receive a message! 🎉

### **Run Continuously (Recommended)**

#### **Option 1: Background Process (Linux/Mac)**
```bash
nohup python email_manager.py > email_manager.log 2>&1 &
```

Check if running:
```bash
ps aux | grep email_manager
```

Stop it:
```bash
pkill -f email_manager.py
```

#### **Option 2: Systemd Service (Linux)**

Create `/etc/systemd/system/email-manager.service`:
```ini
[Unit]
Description=Smart Email Manager
After=network.target

[Service]
Type=simple
User=YOUR_USERNAME
WorkingDirectory=/path/to/email-manager
ExecStart=/usr/bin/python3 /path/to/email-manager/email_manager.py
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable email-manager
sudo systemctl start email-manager
sudo systemctl status email-manager
```

#### **Option 3: Screen (Simple)**
```bash
screen -S email-manager
python email_manager.py
# Press Ctrl+A then D to detach
```

Reattach later:
```bash
screen -r email-manager
```

---

## 📊 Example Telegram Messages

### **With AI Enabled**
```
📬 Résumé Emails — 14/12/2025 12:00
━━━━━━━━━━━━━━━━━━━━━━

🔥 URGENT (1)
━━━━━━━━━━━━━━━━━━━━━━
📧 Pysource
   📌 How to track trajectory of any object...
   🤖 Deadline 48h - Technical course
   
⚡ IMPORTANT (2)
━━━━━━━━━━━━━━━━━━━━━━
📧 LinkedIn Jobs
   📌 Backend & Frontend Developer at Flex Living
   🤖 Real job offer matching dev profile

📧 John Doe
   📌 Recruitment opportunity
   🤖 Personal recruitment email
   📎 Attachment

━━━━━━━━━━━━━━━━━━━━━━
📧 Normal: 5 • 🗑️ Ignored: 12
```

### **Without AI (Basic Mode)**
```
📬 Résumé Emails — 14/12/2025 12:00
━━━━━━━━━━━━━━━━━━━━━━

⚡ IMPORTANT (2)
━━━━━━━━━━━━━━━━━━━━━━
📧 LinkedIn Jobs
   📌 Backend Developer Position
   🤖 Recruitment detected

📧 HR Department
   📌 Interview invitation
   🤖 Recruitment detected
   📎 Attachment

━━━━━━━━━━━━━━━━━━━━━━
📧 Normal: 8 • 🗑️ Ignored: 10
```

---

## ⚙️ Configuration Options

### **Customize Filtering**

Edit `config.py`:

```python
# Always ignore these domains
ALWAYS_IGNORE_DOMAINS = [
    'pinterest.com',
    'discover.pinterest.com',
    'noreply',
    'no-reply',
    'facebook.com',  # Add your own
]

# Always ignore emails with these keywords
ALWAYS_IGNORE_KEYWORDS = [
    'unsubscribe',
    'newsletter',
    'promotion',
    'marketing',
    'discount',
    'sale',  # Add your own
]

# Check interval (in hours)
CHECK_INTERVAL_HOURS = 4  # Change to 1, 2, 6, 12, 24...
```

### **Customize Classification** (without AI)

Edit `email_manager.py` - find the `classify_basic` method:

```python
# Add your own keywords
urgent_keywords = [
    'urgent', 'deadline', 'today',
    'asap',  # ← Add your own
]

important_keywords = [
    'entretien', 'interview', 'job',
    'your_company_name',  # ← Add your own
]
```

---

## 🐛 Troubleshooting

### **Error: "Authentication failed"**
- ✅ Check GMAIL_EMAIL is correct
- ✅ Check GMAIL_APP_PASSWORD has no spaces in config (keep as `xxxx xxxx xxxx xxxx`)
- ✅ Make sure you created an **App Password**, not your regular Gmail password
- ✅ Make sure IMAP is enabled in Gmail settings

### **Error: "Telegram error"**
- ✅ Check TELEGRAM_BOT_TOKEN is correct (no spaces)
- ✅ Check TELEGRAM_CHAT_ID is correct (just numbers)
- ✅ Make sure you sent `/start` to your bot before running

### **No emails detected**
- ✅ Make sure you have **unread** emails in your inbox
- ✅ Check the script is using the right Gmail account
- ✅ Try marking some emails as unread to test

### **AI not working**
- ✅ Check you installed groq: `pip install groq`
- ✅ Check GROQ_API_KEY is correct in config.py
- ✅ Check USE_AI_CLASSIFICATION = True
- ✅ If errors persist, set USE_AI_CLASSIFICATION = False (falls back to basic mode)

### **Too many ignored emails**
- ✅ The system is working! It's filtering spam
- ✅ Customize ALWAYS_IGNORE_DOMAINS and ALWAYS_IGNORE_KEYWORDS
- ✅ If AI is enabled, it should be more accurate

---

## 🔒 Security Best Practices

1. **Never commit config.py to Git**
   - Already in `.gitignore`
   - Create `config.example.py` with empty values to share

2. **Keep your credentials safe**
   - Use environment variables (optional):
     ```bash
     export GMAIL_PASSWORD="xxxx xxxx xxxx xxxx"
     export TELEGRAM_TOKEN="1234..."
     ```
   - Update config.py:
     ```python
     import os
     GMAIL_APP_PASSWORD = os.getenv('GMAIL_PASSWORD')
     TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_TOKEN')
     ```

3. **Rotate credentials regularly**
   - Change App Password every 6 months
   - Regenerate Telegram bot token if compromised

---

## 🎛️ Advanced Usage

### **Run on a Server (VPS/Raspberry Pi)**

1. Install Python 3.8+
2. Clone the project
3. Install dependencies
4. Set up systemd service (see above)
5. Monitor logs:
   ```bash
   journalctl -u email-manager -f
   ```

### **Multiple Email Accounts**

Create separate directories:
```bash
cp -r email-manager email-manager-work
cd email-manager-work
# Edit config.py with work email
python email_manager.py
```

### **Integrate with Other Services**

The code is simple to extend:
- Replace Telegram with Discord/Slack/WhatsApp
- Save emails to a database
- Forward important emails automatically
- Add web dashboard

---

## 📊 Performance & Limits

### **Without AI**
- ⚡ **Speed**: ~0.1s per email
- 💰 **Cost**: FREE
- 🔄 **Reliability**: Very high

### **With AI (Groq)**
- ⚡ **Speed**: ~0.5-1s per email
- 💰 **Cost**: FREE (limit: 30 requests/minute)
- 🔄 **Reliability**: High
- 📊 **Accuracy**: Much better than keywords

**Example**: 30 emails → ~15-30 seconds total with AI

---

## 🗺️ Roadmap (Future Ideas)

- [ ] Web dashboard to view email history
- [ ] Auto-reply to certain emails
- [ ] Email summarization with AI
- [ ] Support for multiple email providers
- [ ] Mobile app
- [ ] Smart learning from your actions

---

## 🤝 Contributing

Feel free to:
- 🐛 Report bugs
- 💡 Suggest features
- 🔧 Submit pull requests
- ⭐ Star the project if useful!

---

## 📝 License

MIT License - Free to use and modify

---

## ❓ FAQ

**Q: Is my email password safe?**  
A: Yes! You use an App Password (not your real password), and it's stored only on your machine.

**Q: Can I use with Outlook/Yahoo?**  
A: Yes, just change IMAP settings in config.py (search for their IMAP settings online).

**Q: Will it mark emails as read?**  
A: No, it only reads UNSEEN emails. They stay unread.

**Q: Can I run this on Windows?**  
A: Yes! Just use `python` instead of `python3` and skip systemd steps.

**Q: How much does Groq AI cost?**  
A: 100% FREE with generous limits (30 req/min = ~1,800 emails/hour).

**Q: What if I hit Groq limits?**  
A: It automatically falls back to basic keyword classification.

**Q: Can I get notifications instantly?**  
A: Change CHECK_INTERVAL_HOURS to a smaller value (minimum 1 hour recommended).

---

## 📞 Support

If you need help:
1. Check this README thoroughly
2. Look at the Troubleshooting section
3. Check your configuration in config.py
4. Enable verbose logging (add print statements)

---

**Made with ❤️ for busy developers who don't want to miss important emails**

---

## 🎯 Quick Start Checklist

- [ ] Python 3.8+ installed
- [ ] Cloned repository
- [ ] Installed dependencies (`pip install -r requirements.txt`)
- [ ] Gmail IMAP enabled
- [ ] Gmail App Password created
- [ ] Telegram bot created
- [ ] Telegram Chat ID obtained
- [ ] config.py configured
- [ ] Tested with `python email_manager.py`
- [ ] Received test message on Telegram ✅
- [ ] (Optional) Groq API key configured
- [ ] (Optional) Set up background service

**You're done! 🎉**
