import imaplib
import email
from email.header import decode_header
from datetime import datetime, timedelta
import schedule
import time
import asyncio
import re
import json
from telegram import Bot
from config import *

try:
    from groq import Groq
    GROQ_AVAILABLE = True
except ImportError:
    GROQ_AVAILABLE = False
    if USE_AI_CLASSIFICATION:
        print("[WARNING]  Groq non installé. Utilisez: pip install groq")

class EmailManager:
    def __init__(self):
        self.last_check = datetime.now() - timedelta(hours=CHECK_INTERVAL_HOURS)
        self.bot = Bot(token=TELEGRAM_BOT_TOKEN)
        
        # Initialize Groq if enabled and available
        self.groq_client = None
        if USE_AI_CLASSIFICATION and GROQ_AVAILABLE and GROQ_API_KEY:
            try:
                self.groq_client = Groq(api_key=GROQ_API_KEY)
            except Exception as e:
                print(f"[WARNING]  Erreur initialisation Groq: {e}")
        
    def connect_gmail(self):
        """Connexion à Gmail via IMAP"""
        try:
            mail = imaplib.IMAP4_SSL(IMAP_SERVER, IMAP_PORT)
            mail.login(GMAIL_EMAIL, GMAIL_APP_PASSWORD)
            return mail
        except Exception as e:
            print(f" Erreur connexion Gmail: {e}")
            return None
    
    def decode_subject(self, subject):
        """Décode le sujet de l'email"""
        if subject is None:
            return ""
        decoded_parts = decode_header(subject)
        return "".join(
            (
                part.decode(encoding or 'utf-8', errors='ignore')
                if isinstance(part, bytes)
                else part
            )
            for part, encoding in decoded_parts
        )
    
    def extract_sender_name(self, sender):
        """Extrait le nom lisible de l'expéditeur"""
        if match := re.match(r'(.*?)\s*<.*>', sender):
            return match[1].strip().strip('"')
        return sender.split('@')[0] if '@' in sender else sender
    
    def is_automated_email(self, sender, subject, body):
        """Détecte si c'est un email automatisé (newsletter/marketing)"""
        text = f"{sender} {subject} {body}".lower()
        
        # Exception: GitHub notifications sont automated MAIS importantes
        if 'github' in sender.lower() or 'github.com' in sender.lower():
            return False
        
        # Indicateurs d'email automatique
        automated_indicators = [
            'noreply',
            'no-reply',
            'notifications@',
            'newsletter',
            'unsubscribe',
            'view in browser',
            'manage preferences',
            'update your settings',
            'you received this email because',
            'sent via',
            'powered by',
        ]
        
        for indicator in automated_indicators:
            if indicator in text:
                return True
        
        return False
    
    def is_personal_email(self, sender, subject, body):
        """Détecte si c'est un email personnel/réel"""
        subject_lower = subject.lower()
        
        # Indicateurs d'email personnel
        personal_indicators = [
            're:',      # Reply
            'fwd:',     # Forward
            'fw:',
            'réponse:', # French reply
            'tr:',      # French forward
        ]
        
        for indicator in personal_indicators:
            if subject_lower.startswith(indicator):
                return True
        
        # Email d'une vraie personne (pas @noreply, @notifications, etc.)
        sender_lower = sender.lower()
        if not any(x in sender_lower for x in ['noreply', 'notifications', 'no-reply', 'info@', 'hello@', 'team@']):
            # Si le corps contient des patterns personnels
            body_lower = body.lower() if body else ""
            personal_body_patterns = [
                'bonjour maria',
                'salut',
                'hi maria',
                'hello maria',
            ]
            for pattern in personal_body_patterns:
                if pattern in body_lower:
                    return True
        
        return False
    
    def should_always_ignore(self, sender, subject, body):
        """Vérifie si l'email doit toujours être ignoré"""
        # Exception AVANT les filtres: GitHub est toujours traité
        if 'github' in sender.lower():
            return False
        
        text = f"{sender} {subject} {body}".lower()
        
        # Check domaines
        for domain in ALWAYS_IGNORE_DOMAINS:
            if domain.lower() in text:
                return True
        
        # Check keywords
        for keyword in ALWAYS_IGNORE_KEYWORDS:
            if keyword.lower() in text:
                return True
        
        # Check si c'est un email automatisé
        if self.is_automated_email(sender, subject, body):
            return True
        
        return False
    
    def classify_with_ai(self, subject, sender, body):
        """Classification intelligente avec Groq AI"""
        if not self.groq_client:
            return self.classify_basic(subject, sender, body)
        
        # Filtre AVANT l'IA (économise des appels API)
        if self.should_always_ignore(sender, subject, body):
            return {
                'category': 'ignore',
                'reason': 'Spam/Marketing',
                'confidence': 'high'
            }
        
        try:
            # Prompt amélioré avec exemples
            prompt = f"""You are an email classifier for a developer. Classify this email STRICTLY.

RULES:
1. URGENT = Only for PERSONAL emails with real deadlines (interview tomorrow, test due in 24h)
2. IMPORTANT = Only for PERSONAL emails (replies, real job offers, GitHub mentions, code reviews)
3. NORMAL = Legitimate personal emails without urgency
4. IGNORE = Newsletters, marketing, automated emails, promotional content

RED FLAGS for IGNORE (auto-classify as IGNORE):
- Contains "unsubscribe" or "view in browser"
- From noreply@, notifications@, hello@, team@
- Newsletter format (weekly digest, product updates)
- Marketing language (discount, sale, limited time offer)
- Automated messages (LinkedIn invitations, Pinterest recommendations)

PERSONAL EMAIL INDICATORS (likely IMPORTANT):
- Subject starts with "Re:" or "Fwd:"
- From a real person's email (not automated)
- GitHub mentions/assignments
- Direct replies to your emails

EMAIL TO ANALYZE:
From: {sender}
Subject: {subject}
Body: {body[:400]}

Think step by step:
1. Is this automated/marketing? → IGNORE
2. Is this a personal email? → Check urgency
3. Does it require action in 24-48h? → URGENT
4. Is it from a real person about work/recruitment? → IMPORTANT

Respond ONLY with JSON:
{{"category": "urgent|important|normal|ignore", "reason": "brief explanation (max 6 words)", "confidence": "high|medium|low"}}"""

            response = self.groq_client.chat.completions.create(
                messages=[{"role": "user", "content": prompt}],
                model="llama-3.3-70b-versatile",
                temperature=0.2,  # Plus déterministe
                max_tokens=150
            )
            
            result_text = response.choices[0].message.content.strip()
            
            # Extract JSON from response
            if '{' in result_text and '}' in result_text:
                start = result_text.index('{')
                end = result_text.rindex('}') + 1
                result_text = result_text[start:end]
            
            result = json.loads(result_text)
            return result
            
        except Exception as e:
            print(f"[WARNING]  IA erreur: {e}, fallback basique")
            return self.classify_basic(subject, sender, body)
    
    def classify_basic(self, subject, sender, body):
        """Classification basique sans IA"""
        subject_lower = subject.lower()
        sender_lower = sender.lower()
        body_lower = body.lower() if body else ""
        
        # Toujours ignorer certains
        if self.should_always_ignore(sender, subject, body):
            return {
                'category': 'ignore',
                'reason': 'Spam/Marketing',
                'confidence': 'high'
            }
        
        # BOOST: Email personnel → TOUJOURS important minimum
        if self.is_personal_email(sender, subject, body):
            # Si c'est une reply ET contient des keywords urgents
            if any(kw in subject_lower or kw in body_lower for kw in ['urgent', 'deadline', 'asap', 'today', 'demain']):
                return {
                    'category': 'urgent',
                    'reason': 'Personal email + urgent keyword',
                    'confidence': 'high'
                }
            return {
                'category': 'important',
                'reason': 'Personal email',
                'confidence': 'high'
            }
        
        # Mots-clés URGENT (mais SEULEMENT si pas automated)
        urgent_keywords = [
            'urgent', 'deadline', 'asap',
            'expires today', 'expires tomorrow',
            'action required immediately',
            'répondre avant',
            'dans les 24h', 'dans les 48h'
        ]
        
        # Mots-clés IMPORTANT (recrutement RÉEL)
        important_keywords = [
            'entretien confirmé',
            'interview scheduled',
            'test technique à rendre',
            'candidature retenue',
            'shortlisted',
            'vous avez été sélectionné',
            'offre ferme',
            'contrat',
            'github.*mentioned you',  # Mentions GitHub
            'github.*assigned',       # Assigné sur GitHub
            'pull request.*review',   # Code review
        ]
        
        # LinkedIn: seulement VRAIES opportunités
        if 'linkedin' in sender_lower:
            # Invitations = IGNORE
            if 'invitations@' in sender_lower or 'demande de connexion' in subject_lower:
                return {
                    'category': 'ignore',
                    'reason': 'LinkedIn invitation',
                    'confidence': 'high'
                }
            # Jobs alerts = IGNORE (trop de spam)
            if 'jobs-listings@' in sender_lower:
                return {
                    'category': 'ignore',
                    'reason': 'LinkedIn job alert (automated)',
                    'confidence': 'high'
                }
            # Messages directs = IMPORTANT
            if 'messaging-digest@' in sender_lower or 'message from' in subject_lower:
                return {
                    'category': 'important',
                    'reason': 'LinkedIn direct message',
                    'confidence': 'medium'
                }
        
        # Check URGENT (mais pas si automated)
        for keyword in urgent_keywords:
            if keyword in subject_lower or keyword in body_lower:
                return {
                    'category': 'urgent',
                    'reason': f'Deadline detected',
                    'confidence': 'medium'
                }
        
        # Check IMPORTANT (recrutement réel)
        for keyword in important_keywords:
            if keyword in subject_lower or keyword in body_lower:
                return {
                    'category': 'important',
                    'reason': 'Recruitment detected',
                    'confidence': 'medium'
                }
        
        # Patterns GitHub/code
        if 'github' in sender_lower or 'github' in subject_lower:
            github_important = ['mentioned', 'assigned', 'review requested', 'approved', 'merged']
            if any(kw in subject_lower or kw in body_lower for kw in github_important):
                return {
                    'category': 'important',
                    'reason': 'GitHub notification',
                    'confidence': 'high'
                }
        
        return {
            'category': 'normal',
            'reason': 'Standard email',
            'confidence': 'low'
        }
    
    def classify_email(self, subject, sender, body):
        """Main classification dispatcher"""
        if self.groq_client:
            return self.classify_with_ai(subject, sender, body)
        else:
            return self.classify_basic(subject, sender, body)
    
    def get_email_body(self, msg):
        """Extrait le corps de l'email"""
        body = ""
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == "text/plain":
                    try:
                        body = part.get_payload(decode=True).decode('utf-8', errors='ignore')
                    except:
                        body = ""
                    break
        else:
            try:
                body = msg.get_payload(decode=True).decode('utf-8', errors='ignore')
            except:
                body = ""
        return body[:800]
    
    def fetch_new_emails(self):
        """Récupère les nouveaux emails depuis la dernière vérification"""
        mail = self.connect_gmail()
        if not mail:
            return []
        
        try:
            mail.select('INBOX')
            
            # Chercher les emails non lus
            status, messages = mail.search(None, 'UNSEEN')
            email_ids = messages[0].split()
            
            emails = []
            for email_id in email_ids[-30:]:  # Limite aux 30 derniers
                status, msg_data = mail.fetch(email_id, '(RFC822)')
                msg = email.message_from_bytes(msg_data[0][1])
                
                subject = self.decode_subject(msg.get('Subject'))
                sender = msg.get('From')
                sender_name = self.extract_sender_name(sender)
                body = self.get_email_body(msg)
                
                # Classification
                classification = self.classify_email(subject, sender, body)
                
                # Détecter pièces jointes
                has_attachment = False
                if msg.is_multipart():
                    for part in msg.walk():
                        if part.get_content_disposition() == 'attachment':
                            has_attachment = True
                            break
                
                emails.append({
                    'subject': subject,
                    'sender': sender,
                    'sender_name': sender_name,
                    'category': classification.get('category', 'normal'),
                    'reason': classification.get('reason', ''),
                    'has_attachment': has_attachment
                })
            
            mail.close()
            mail.logout()
            
            return emails
            
        except Exception as e:
            print(f"[ERROR] Erreur récupération emails: {e}")
            return []
    
    def build_summary(self, emails):
        """Construit le résumé des emails"""
        urgent = [e for e in emails if e['category'] == 'urgent']
        important = [e for e in emails if e['category'] == 'important']
        normal = [e for e in emails if e['category'] == 'normal']
        ignored = [e for e in emails if e['category'] == 'ignore']
        
        now = datetime.now().strftime('%d/%m/%Y %H:%M')
        
        # Si aucun email important
        if not urgent and not important and not normal:
            return f"No important emails\n{len(ignored)} ignored (spam/newsletters)"
        
        message = f"*Email Summary* - {now}\n"
        message += "=" * 40 + "\n\n"
        
        # URGENT
        if urgent:
            message += f"*URGENT ({len(urgent)})*\n"
            message += "-" * 40 + "\n"
            for e in urgent:
                message += f"From: *{e['sender_name']}*\n"
                message += f"Subject: {e['subject'][:60]}\n"
                if e.get('reason'):
                    message += f"Reason: {e['reason']}\n"
                if e.get('has_attachment'):
                    message += f"[Attachment]\n"
                message += "\n"
        
        # IMPORTANT
        if important:
            message += f"*IMPORTANT ({len(important)})*\n"
            message += "-" * 40 + "\n"
            for e in important:
                message += f"From: *{e['sender_name']}*\n"
                message += f"Subject: {e['subject'][:60]}\n"
                if e.get('reason'):
                    message += f"Reason: {e['reason']}\n"
                if e.get('has_attachment'):
                    message += f"[Attachment]\n"
                message += "\n"
        
        # Footer stats
        stats = []
        if normal:
            stats.append(f"Normal: {len(normal)}")
        if ignored:
            stats.append(f"Ignored: {len(ignored)}")
        
        if stats:
            message += "=" * 40 + "\n"
            message += " | ".join(stats) + "\n"
        
        return message
    
    async def send_telegram(self, message):
        """Envoie le message sur Telegram"""
        try:
            await self.bot.send_message(
                chat_id=TELEGRAM_CHAT_ID,
                text=message,
                parse_mode='Markdown'
            )
            print("[SUCCESS] Message envoyé sur Telegram")
        except Exception as e:
            print(f"[ERROR] Erreur envoi Telegram: {e}")
            # Retry sans markdown si erreur
            try:
                await self.bot.send_message(
                    chat_id=TELEGRAM_CHAT_ID,
                    text=message.replace('*', '').replace('_', '')
                )
            except:
                pass
    
    def check_emails(self):
        """Fonction principale - vérifie les emails et envoie le résumé"""
        print(f"\n[CHECK] Checking emails... {datetime.now()}")
        
        emails = self.fetch_new_emails()
        
        if emails:
            print(f"[INFO] {len(emails)} new emails found")
            
            # Stats par catégorie
            urgent = len([e for e in emails if e['category'] == 'urgent'])
            important = len([e for e in emails if e['category'] == 'important'])
            normal = len([e for e in emails if e['category'] == 'normal'])
            ignored = len([e for e in emails if e['category'] == 'ignore'])
            
            print(f"       Urgent: {urgent} | Important: {important} | Normal: {normal} | Ignored: {ignored}")
            
            summary = self.build_summary(emails)
            asyncio.run(self.send_telegram(summary))
        else:
            print("[INFO] No new emails")
        
        self.last_check = datetime.now()

def main():
    import os
    
    # Check if running in GitHub Actions
    is_github_actions = os.getenv('GITHUB_ACTIONS') == 'true'
    
    ai_status = "ENABLED" if USE_AI_CLASSIFICATION and GROQ_API_KEY else "DISABLED"
    print("[START] Email Manager v2")
    print(f"        Check interval: every {CHECK_INTERVAL_HOURS} hours")
    print(f"        AI Classification: {ai_status}")
    
    if is_github_actions:
        print("        Mode: GitHub Actions (one-shot)")
    
    manager = EmailManager()
    
    # Première vérification immédiate
    manager.check_emails()
    
    # If GitHub Actions, exit after one check
    if is_github_actions:
        print("\n[INFO] GitHub Actions mode - exiting after check")
        return
    
    # Otherwise, run continuously
    # Planifier les vérifications périodiques
    schedule.every(CHECK_INTERVAL_HOURS).hours.do(manager.check_emails)
    
    # Boucle infinie
    print("\n[INFO] Waiting for next check...\n")
    while True:
        schedule.run_pending()
        time.sleep(60)

if __name__ == "__main__":
    main()