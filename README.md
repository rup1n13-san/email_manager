# Smart Email Manager with AI Classification

Automatically monitors your Gmail inbox and sends intelligent summaries to Telegram. Perfect for never missing important emails while filtering out spam.

**Key benefits:**
- Never miss job offers or recruitment emails
- Automatically filter spam and newsletters
- AI-powered classification (optional, free with Groq)
- Clean summaries delivered to Telegram

---

## Features

- **Smart Classification**: Urgent, Important, Normal, or Ignore
- **AI-Powered** (optional): Context-aware email understanding with Groq
- **Spam Filtering**: Automatically ignores newsletters and marketing
- **Personal Email Detection**: Prioritizes replies and forwards
- **Telegram Notifications**: Clean, formatted summaries every 4 hours
- **GitHub Actions Ready**: Deploy for free without a server

---

## Quick Start

### Option 1: GitHub Actions (Recommended)

No server needed. Runs on GitHub's infrastructure for free.

1. **Fork this repository**

2. **Add secrets** (Settings > Secrets > Actions):
   - `GMAIL_EMAIL`: your.email@gmail.com
   - `GMAIL_APP_PASSWORD`: your Gmail app password
   - `TELEGRAM_BOT_TOKEN`: your Telegram bot token
   - `TELEGRAM_CHAT_ID`: your Telegram chat ID
   - `GROQ_API_KEY`: (optional) your Groq API key

3. **Enable workflow** (Actions tab > Enable)

4. **Run manually** to test (Actions > Email Manager > Run workflow)

Done! It will run automatically every 4 hours.

See [GITHUB_ACTIONS_GUIDE.md](GITHUB_ACTIONS_GUIDE.md) for details.

### Option 2: Local/VPS Deployment

```bash
# Clone and install
git clone https://github.com/rup1n13-san/email_manager.git
cd email_manager
pip install -r requirements.txt

# Configure
cp config.example.py config.py
# Edit config.py with your credentials

# Run
python email_manager.py

# Or run in background
nohup python email_manager.py > email_manager.log 2>&1 &
```

---

## Configuration

### Gmail Setup

1. **Enable IMAP**: Gmail Settings > Forwarding and POP/IMAP > Enable IMAP
2. **Create App Password**:
   - Go to [Google Account Security](https://myaccount.google.com/security)
   - Enable 2-Step Verification
   - Search "App passwords"
   - Create password for Mail > Other device
   - Copy the 16-character password

### Telegram Setup

1. **Create Bot**:
   - Message @BotFather on Telegram
   - Send `/newbot` and follow prompts
   - Copy the bot token

2. **Get Chat ID**:
   - Send `/start` to your bot
   - Visit: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
   - Find your chat ID in the response

### AI Setup (Optional)

1. Sign up at [console.groq.com](https://console.groq.com)
2. Create API key
3. Add to config: `GROQ_API_KEY = "gsk_..."`
4. Set `USE_AI_CLASSIFICATION = True`

---

## Customization

Edit `config.py`:

```python
# Check frequency (for local deployment)
CHECK_INTERVAL_HOURS = 4

# Domains to ignore
ALWAYS_IGNORE_DOMAINS = [
    'pinterest.com',
    'prezi.com',
    'laravel.com',
]

# Keywords to ignore
ALWAYS_IGNORE_KEYWORDS = [
    'unsubscribe',
    'newsletter',
    'promotion',
]
```

For GitHub Actions schedule, edit `.github/workflows/email-check.yml`:
```yaml
schedule:
  - cron: '0 */3 * * *'  # Every 3 hours
```

---

## Example Output

```
*Email Summary* - 14/12/2025 12:00
========================================

*URGENT (1)*
----------------------------------------
From: *Tech Company*
Subject: Technical test due tomorrow
Reason: Deadline detected
[Attachment]

*IMPORTANT (2)*
----------------------------------------
From: *LinkedIn Jobs*
Subject: Backend Developer position
Reason: Job offer

From: *Recruiter*
Subject: Re: Application
Reason: Personal email

========================================
Normal: 5 | Ignored: 12
```

---

## Troubleshooting

**Gmail connection fails:**
- Use App Password, not your regular password
- Verify IMAP is enabled
- Check 2-Step Verification is enabled

**No Telegram messages:**
- Verify bot token and chat ID
- Send `/start` to your bot first
- Check bot has permission to message you

**AI not working:**
- Verify Groq API key is valid
- Check `USE_AI_CLASSIFICATION = True`
- Ensure `groq` is installed: `pip install groq`

---

## Project Structure

```
email-manager/
├── email_manager.py          # Main application
├── config.py                 # Your configuration (gitignored)
├── config.example.py         # Configuration template
├── requirements.txt          # Dependencies
├── .github/workflows/        # GitHub Actions
└── README.md
```

---

## Technical Stack

- Python 3.8+
- Gmail IMAP API
- Telegram Bot API
- Groq AI (Llama 3.3 70B)
- GitHub Actions

---

## License

MIT License

---

## Author

[@rup1n13-san](https://github.com/rup1n13-san)
