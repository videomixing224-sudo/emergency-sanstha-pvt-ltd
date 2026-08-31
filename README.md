# Emergency Sanstha Pvt Ltd Portal

Full-stack starter for:
- Admin Panel
- Customer Panel
- Investor Panel / Customer Invest Plan
- Mobile + OTP login flow
- Loan management
- Investment management
- Documents
- Service Requests
- Account Mandate
- Loan Closure requests
- Multi-language selector

## Run

1. Install Node.js 20+.
2. Copy `.env.example` to `.env` and change `JWT_SECRET` and admin password.
3. Run:
   npm install
   npm start
4. Open:
   http://localhost:3000

Default admin:
- Email: admin@emergencysanstha.local
- Password: ChangeMe123!

## Demo OTP
With `OTP_MODE=demo`, the API returns the OTP in the JSON response for testing. This MUST be disabled in production.

## Production checklist
- Integrate a real SMS OTP provider.
- Use HTTPS.
- Change admin credentials.
- Use a strong JWT secret.
- Put uploaded documents in private object storage.
- Add KYC/consent/audit requirements appropriate to your business and jurisdiction.
- Add database backups and monitoring.
- Review applicable RBI, lending, KYC/AML, privacy and data-retention requirements with qualified professionals before going live.
