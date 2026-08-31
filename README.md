# Emergency Sanstha Pvt Ltd Portal

Full-stack starter for:
- Admin Panel
- Customer Panel
- Investor Panel / Customer Invest Plan
- Admin-created customer login: mobile number as User ID + password
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


## Loan workflow
- Admin creates/selects a customer and gives a loan.
- Customer User ID is always the registered 10-digit mobile number.
- Admin can set a password or leave it blank for a secure auto-generated password.
- Loan duration is stored in days.
- Payment frequency can be Weekly or Monthly.
- Admin can mark a loan as Cleared (outstanding becomes ₹0).
- Cleared/closed loans can be deleted.
- A customer can be deleted only when there is no outstanding loan.


## Loan Agreement + Customer Signature
- When Admin creates a loan, a loan agreement record is created automatically.
- Admin can open/print the agreement PDF from Loan Management.
- Customer can open the agreement from My Loan & Payments.
- Customer can sign using mouse/touch in the signature box.
- After signing, the signed signature is stored against that loan and the PDF shows the signature and signed date.
- The PDF includes customer details, loan details, payment summary, status and acknowledgement text.
- For production, use the legally required e-sign/e-stamp/KYC/consent process applicable to your lending business; the canvas signature feature is an acknowledgement mechanism, not a claim of statutory digital-signature compliance.
