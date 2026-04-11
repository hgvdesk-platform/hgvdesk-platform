# HGVDESK — COMPLETE DEPLOYMENT GUIDE
# Zero experience needed. Copy and paste every command exactly as written.
# Estimated time: 45–60 minutes
# ══════════════════════════════════════════════════════════════════════

## WHAT YOU'LL HAVE AT THE END
  hgvdesk.co.uk          → Command (master dashboard)
  app.hgvdesk.co.uk      → Workshop
  inspect.hgvdesk.co.uk  → Inspect
  parts.hgvdesk.co.uk    → Parts
  api.hgvdesk.co.uk/api  → Backend API

  All on your own server. No AI companies. No shared hosting.
  £4/month. Your data. Your machine.

═══════════════════════════════════════════════════════════════════════
## STEP 1 — BUY THE DOMAIN
═══════════════════════════════════════════════════════════════════════

1. Go to https://www.namecheap.com
2. Search: hgvdesk.co.uk
3. Buy it (around £10/year)
4. Log in to Namecheap dashboard → Manage → Advanced DNS
5. DELETE all existing DNS records
6. We'll add new ones in Step 4 once you have your server IP

═══════════════════════════════════════════════════════════════════════
## STEP 2 — CREATE YOUR HETZNER SERVER
═══════════════════════════════════════════════════════════════════════

1. Go to https://www.hetzner.com/cloud
2. Create a free account (no card needed yet)
3. Add a payment method (they charge monthly in arrears, £4/month)
4. Click "New Project" → name it "hgvdesk"
5. Click "Add Server":
   - Location: Nuremberg (or Helsinki for UK — both fine)
   - Image: Ubuntu 24.04
   - Type: CX22 (2 vCPU, 4GB RAM) — £4.19/month
   - SSH Keys: click "Add SSH Key"
     - On your computer open Terminal (Mac) or PowerShell (Windows)
     - Run: ssh-keygen -t ed25519 -C "hgvdesk"
     - Press Enter 3 times (accept defaults)
     - Run: cat ~/.ssh/id_ed25519.pub
     - Copy the entire output and paste it into Hetzner
   - Name: hgvdesk-prod
6. Click "Create & Buy"
7. WRITE DOWN YOUR SERVER IP ADDRESS (shown after creation, e.g. 65.21.xxx.xxx)

═══════════════════════════════════════════════════════════════════════
## STEP 3 — CONNECT TO YOUR SERVER
═══════════════════════════════════════════════════════════════════════

On your computer, open Terminal (Mac) or PowerShell (Windows):

    ssh root@YOUR_SERVER_IP

Type "yes" if it asks about fingerprint.
You are now inside your server.

═══════════════════════════════════════════════════════════════════════
## STEP 4 — POINT YOUR DOMAIN TO THE SERVER
═══════════════════════════════════════════════════════════════════════

Back in Namecheap → Advanced DNS, add these records:
(Replace 65.21.xxx.xxx with YOUR actual server IP)

  Type    Host        Value              TTL
  A       @           65.21.xxx.xxx      Automatic
  A       www         65.21.xxx.xxx      Automatic
  A       app         65.21.xxx.xxx      Automatic
  A       inspect     65.21.xxx.xxx      Automatic
  A       parts       65.21.xxx.xxx      Automatic
  A       api         65.21.xxx.xxx      Automatic

DNS takes 10–30 minutes to propagate. Continue with the next steps
while you wait.

═══════════════════════════════════════════════════════════════════════
## STEP 5 — SET UP THE SERVER
═══════════════════════════════════════════════════════════════════════

Copy and paste this ENTIRE block into your server terminal.
It runs as one command:

--------------------------------------------------------------------
apt update && apt upgrade -y

# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# Install PostgreSQL
apt install -y postgresql postgresql-contrib

# Install Nginx
apt install -y nginx

# Install Certbot (for free SSL)
apt install -y certbot python3-certbot-nginx

# Install git
apt install -y git

# Verify installs
node --version
npm --version
psql --version
nginx --version

echo "✅ All dependencies installed"
--------------------------------------------------------------------

═══════════════════════════════════════════════════════════════════════
## STEP 6 — SET UP THE DATABASE
═══════════════════════════════════════════════════════════════════════

Still in your server terminal, run these one at a time:

    sudo -u postgres psql

You'll see a "postgres=#" prompt. Now type these (press Enter after each):

    CREATE DATABASE hgv_platform;
    CREATE USER hgv_user WITH ENCRYPTED PASSWORD 'CHOOSE_A_STRONG_PASSWORD_HERE';
    GRANT ALL PRIVILEGES ON DATABASE hgv_platform TO hgv_user;
    ALTER DATABASE hgv_platform OWNER TO hgv_user;
    \q

IMPORTANT: Write down the password you chose. You need it in Step 8.

═══════════════════════════════════════════════════════════════════════
## STEP 7 — CREATE THE APP USER AND FOLDERS
═══════════════════════════════════════════════════════════════════════

    useradd -m -s /bin/bash hgv
    mkdir -p /var/www/hgv-platform
    chown -R hgv:hgv /var/www/hgv-platform

═══════════════════════════════════════════════════════════════════════
## STEP 8 — UPLOAD YOUR CODE
═══════════════════════════════════════════════════════════════════════

On YOUR COMPUTER (not the server), open a new terminal window and run:

    scp -r /path/to/hgv-platform/* root@YOUR_SERVER_IP:/var/www/hgv-platform/

(Replace /path/to/hgv-platform with where you saved the files)

Back in the SERVER terminal:

    cd /var/www/hgv-platform/server
    npm install
    chown -R hgv:hgv /var/www/hgv-platform

═══════════════════════════════════════════════════════════════════════
## STEP 9 — CONFIGURE ENVIRONMENT VARIABLES
═══════════════════════════════════════════════════════════════════════

    cd /var/www/hgv-platform/server
    cp .env.example .env
    nano .env

Edit these values (use arrow keys to navigate, Ctrl+X to save):

    DB_PASSWORD=the_password_you_chose_in_step_6
    JWT_SECRET=    ← paste output of: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
    ADMIN_EMAIL=your@email.com
    ADMIN_PASSWORD=choose_a_strong_admin_password

Save with Ctrl+X, then Y, then Enter.

Secure the file:
    chmod 600 .env

═══════════════════════════════════════════════════════════════════════
## STEP 10 — INSTALL THE SERVICE (keeps it running 24/7)
═══════════════════════════════════════════════════════════════════════

    cp /var/www/hgv-platform/deploy/hgv-platform.service /etc/systemd/system/
    systemctl daemon-reload
    systemctl enable hgv-platform
    systemctl start hgv-platform

Check it started:
    systemctl status hgv-platform

You should see "active (running)" in green.

View live logs:
    journalctl -u hgv-platform -f

═══════════════════════════════════════════════════════════════════════
## STEP 11 — CONFIGURE NGINX
═══════════════════════════════════════════════════════════════════════

    cp /var/www/hgv-platform/deploy/nginx.conf /etc/nginx/sites-available/hgvdesk
    ln -s /etc/nginx/sites-available/hgvdesk /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default

Test nginx config:
    nginx -t

If it says "test is successful", continue.

═══════════════════════════════════════════════════════════════════════
## STEP 12 — GET FREE SSL CERTIFICATE
═══════════════════════════════════════════════════════════════════════

WAIT until your DNS has propagated (test: ping hgvdesk.co.uk — should return your server IP)

    certbot --nginx -d hgvdesk.co.uk -d www.hgvdesk.co.uk -d app.hgvdesk.co.uk -d inspect.hgvdesk.co.uk -d parts.hgvdesk.co.uk

Follow the prompts:
- Enter your email
- Agree to terms (A)
- Choose whether to share email (N is fine)

Certbot automatically updates your nginx config with SSL.

Restart nginx:
    systemctl restart nginx
    systemctl enable nginx

═══════════════════════════════════════════════════════════════════════
## STEP 13 — SET UP FIREWALL
═══════════════════════════════════════════════════════════════════════

    ufw allow ssh
    ufw allow 80
    ufw allow 443
    ufw --force enable
    ufw status

═══════════════════════════════════════════════════════════════════════
## STEP 14 — TEST EVERYTHING
═══════════════════════════════════════════════════════════════════════

Open your browser and visit:

  https://hgvdesk.co.uk         → Should show Command dashboard
  https://app.hgvdesk.co.uk     → Should show Workshop
  https://inspect.hgvdesk.co.uk → Should show Inspect
  https://parts.hgvdesk.co.uk   → Should show Parts
  https://hgvdesk.co.uk/api/health → Should show {"status":"healthy"}

Log in with the admin email and password you set in Step 9.

═══════════════════════════════════════════════════════════════════════
## YOU'RE LIVE. HGVDESK IS RUNNING ON YOUR SERVER.
═══════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════
## USEFUL COMMANDS (save these)
═══════════════════════════════════════════════════════════════════════

View live logs:
    journalctl -u hgv-platform -f

Restart the app:
    systemctl restart hgv-platform

Stop the app:
    systemctl stop hgv-platform

Check server status:
    systemctl status hgv-platform

Reload nginx after config changes:
    systemctl reload nginx

Check disk usage:
    df -h

Check memory:
    free -h

SSL renews automatically. Certbot installs a cron job.
To manually renew: certbot renew

═══════════════════════════════════════════════════════════════════════
## IF SOMETHING GOES WRONG
═══════════════════════════════════════════════════════════════════════

App not starting:
    journalctl -u hgv-platform -n 50

Database connection error:
    - Check .env DB_PASSWORD matches what you set in Step 6
    - Check PostgreSQL is running: systemctl status postgresql

Nginx error:
    nginx -t
    journalctl -u nginx -n 20

Can't reach the site:
    - Check DNS has propagated: nslookup hgvdesk.co.uk
    - Check firewall: ufw status
    - Check nginx is running: systemctl status nginx

═══════════════════════════════════════════════════════════════════════
## COSTS SUMMARY
═══════════════════════════════════════════════════════════════════════

  Domain (Namecheap):   ~£10/year
  Server (Hetzner CX22): £4.19/month
  SSL (Let's Encrypt):   FREE
  Database (PostgreSQL): FREE (runs on same server)
  ─────────────────────────────────
  Total:                ~£60/year (~£5/month)

  First paying customer at £49/month covers all costs.

═══════════════════════════════════════════════════════════════════════
