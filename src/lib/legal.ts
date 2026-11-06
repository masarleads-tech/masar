import type { Lang } from "./i18n";

/**
 * Fill these in before going live. They appear in all three policies.
 * Have a lawyer licensed in your country of registration review the final text.
 */
export const COMPANY = {
  name: "[Company legal name]",
  licence: "[Trade licence number and issuing authority, e.g. DED Dubai / Ministry of Commerce KSA]",
  address: "[Registered address]",
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL || "[contact email]",
  privacyEmail: process.env.NEXT_PUBLIC_PRIVACY_EMAIL || process.env.NEXT_PUBLIC_CONTACT_EMAIL || "[privacy email]",
  law: "[Governing law, e.g. the laws of the Emirate of Dubai and the federal laws of the UAE]",
  courts: "[Courts, e.g. the courts of Dubai]",
  updated: "29 October 2026",
};

export type DocKey = "privacy" | "terms" | "refund";
export interface LegalDoc { title: string; intro: string; sections: { h: string; p: string[] }[] }

const c = COMPANY;

const en: Record<DocKey, LegalDoc> = {
  privacy: {
    title: "Privacy policy",
    intro: `This policy explains how ${c.name} ("Masar", "we") collects and uses personal data when you use the Masar website and service. We follow the UAE Personal Data Protection Law (Federal Decree-Law No. 45 of 2021), the Saudi Personal Data Protection Law (Royal Decree M/19 of 1443H, as amended) and the data protection laws of the other GCC countries where our users are based.`,
    sections: [
      { h: "1. Who is responsible", p: [
        `${c.name}, ${c.licence}, ${c.address}, is the controller of your account data. Contact: ${c.privacyEmail}.`,
        "For lead data you download and use, you become an independent controller and are responsible for how you use it (see section 6).",
      ] },
      { h: "2. Data we collect about you", p: [
        "Account data: your email address, password (stored only as a secure hash by our login provider), sign-up and confirmation dates.",
        "Service data: the searches you run (what you sell, target customer, cities), the results we return to you, your plan, and the number of leads used.",
        "Technical data: login session cookies, IP address and basic logs needed to keep the service secure.",
        "Usage data: the pages you visit and the buttons you use on the Masar website, to understand how the service is used and improve it.",
        "Payment data: if you subscribe, payment is handled by our payment provider or by bank transfer. We keep the invoice record, not your full card details.",
      ] },
      { h: "3. Data in the leads we find", p: [
        "Masar searches public sources (Google Maps listings, business websites, and public Instagram, Facebook and LinkedIn pages) for business contact information: business name, address, business phone and email, website, public social accounts, and the names and job titles of people in public business roles.",
        "We do not log in to any platform, bypass access controls, or collect private messages, personal mobile numbers that were not published for business, ID numbers, health data or other sensitive data.",
        "Every value in a lead is linked to the public page it came from. We do not keep a separate database of the people in your results beyond what is needed to deliver your search.",
      ] },
      { h: "4. Why we use your data (legal basis)", p: [
        "To provide the service you signed up for (performance of a contract): your account, searches, results, trial and plan.",
        "To keep the service secure and prevent abuse (legitimate interest and legal obligation).",
        "To send service emails such as confirmation, password reset and plan changes. We only send marketing emails if you agree, and you can opt out at any time.",
        "Business contact data in leads is processed for B2B prospecting based on legitimate interest, limited to information the business or person published for business purposes.",
      ] },
      { h: "5. Who we share data with", p: [
        "Supabase (account login and database), Vercel (website hosting), Anthropic (AI research on public web pages; your search text is sent to it to run the research), Google (Maps search, when enabled), PostHog (website analytics), Sentry (error reports, without IP addresses) and our payment provider.",
        "These providers process data on our behalf under written terms. We do not sell your personal data.",
        "We may disclose data where required by law or by a competent authority in the UAE, Saudi Arabia or another GCC country.",
      ] },
      { h: "6. Your responsibilities when using leads", p: [
        "You must use leads only for legitimate business-to-business contact, and comply with the laws that apply to you, including the UAE TDRA rules on unsolicited marketing, the Saudi CST rules on marketing messages, and data protection laws.",
        "Stop contacting anyone who asks you to, keep an opt-out list, and do not use leads for spam, harassment, or resale as a contact list.",
      ] },
      { h: "7. International transfers", p: [
        "Some providers store or process data outside your country (for example in the European Union or the United States). We only use providers that offer appropriate safeguards, such as contractual protections, as required by Article 22 and 23 of the UAE PDPL and the Saudi transfer regulations.",
      ] },
      { h: "8. How long we keep data", p: [
        "Account data: while your account is open and up to 12 months after it is closed, unless the law requires longer (for example, invoices are kept as long as tax law requires).",
        "Search results are kept in your browser. Server logs are kept for up to 90 days.",
      ] },
      { h: "9. Your rights", p: [
        "Depending on where you live, you can ask to access, correct, delete or receive a copy of your data, restrict or object to processing, and withdraw consent. Email " + c.privacyEmail + ". We reply within 30 days.",
        "If you are a business owner or employee who appears in a lead and want your details removed or corrected, email us and we will act on it.",
        "You can also complain to your data protection authority, for example the UAE Data Office or the Saudi Data & AI Authority (SDAIA).",
      ] },
      { h: "10. Security", p: [
        "We use encrypted connections (HTTPS), hashed passwords, access controls on the database so users can only see their own account, and keep API keys on the server only.",
        "If a data breach affects your personal data, we will notify you and the relevant authority as the law requires.",
      ] },
      { h: "11. Cookies", p: [
        "We use the cookies needed to keep you logged in and remember your language, and an analytics cookie from PostHog that counts visits and shows us which parts of the site are used. We do not use advertising cookies.",
      ] },
      { h: "12. Children", p: ["Masar is a business service and is not for people under 18."] },
      { h: "13. Changes", p: [`We will post any change on this page and, for important changes, email you. Last updated: ${c.updated}.`] },
    ],
  },
  terms: {
    title: "Terms of service",
    intro: `These terms are an agreement between you and ${c.name} ("Masar", "we") for the use of the Masar website and service. By creating an account you accept them. If you use Masar for a company, you confirm you may accept these terms for it.`,
    sections: [
      { h: "1. The service", p: [
        "Masar finds potential business customers from public sources, checks their public contact details and online presence, and gives each lead a fit score and an estimated closing chance.",
        "Scores and checks are estimates made by software, including AI. They are not guarantees. Business details change, and some information may be out of date or wrong. Always check before relying on a lead.",
      ] },
      { h: "2. Accounts", p: [
        "You must give a valid email address and confirm it. You must be at least 18 and use the service for business purposes.",
        "Keep your password safe. You are responsible for activity on your account. One free trial per person or business.",
      ] },
      { h: "3. Plans and leads", p: [
        "Free trial: 10 leads, given once after your email is confirmed.",
        "Basic plan: 300 leads per 30-day month while your subscription is active. One lead uses one credit. Unused leads do not carry over to the next month.",
        "Premium plan: everything in Basic, plus unlimited leads through the Masar CLI.",
        "One lead is used each time Masar finishes checking a business for you. Prices and plan details are shown before you pay and may change for future periods with notice.",
      ] },
      { h: "4. Acceptable use", p: [
        "You may use leads only for lawful business-to-business contact. You must not: send spam or bulk unsolicited messages; harass anyone; resell or publish lead lists; use leads for fraud, discrimination or any unlawful purpose; or try to break, overload, copy or reverse-engineer the service.",
        "You must comply with the laws that apply to your outreach, including the UAE Federal Decree-Law No. 45 of 2021 (PDPL), the UAE Federal Decree-Law No. 34 of 2021 on combating rumours and cybercrimes, TDRA rules on unsolicited communications, the Saudi PDPL, the Saudi Anti-Cyber Crime Law, and CST rules on marketing messages.",
        "We may suspend or close accounts that break these rules, without refund for the period of misuse.",
      ] },
      { h: "5. Data and privacy", p: [
        "Our Privacy policy explains how we handle personal data. When you download leads, you are responsible for using them in line with data protection law, including honouring requests to stop contact.",
      ] },
      { h: "6. Intellectual property", p: [
        "The Masar software, brand and design belong to us. You own your search inputs. You may use the results you receive for your own business. Public data in results belongs to its owners.",
      ] },
      { h: "7. Third-party services", p: [
        "Masar relies on third-party services (such as Google, Anthropic, Supabase and Vercel) and on public websites. We are not responsible for their availability or content.",
      ] },
      { h: "8. Liability", p: [
        "The service is provided \"as is\". To the extent the law allows, we are not liable for indirect or consequential loss, lost profits or lost deals, and our total liability in any 12 months is limited to the amount you paid us in that period.",
        "Nothing in these terms limits rights you have under consumer protection law that cannot be excluded, including UAE Federal Law No. 15 of 2020 on Consumer Protection and the Saudi E-Commerce Law.",
      ] },
      { h: "9. Ending the service", p: [
        "You can close your account at any time by emailing us. We may end the service with 30 days' notice, and will refund any unused prepaid period in that case.",
      ] },
      { h: "10. Electronic records", p: [
        "You agree that these terms, notices and invoices may be provided electronically, which has the same effect as paper under UAE Federal Decree-Law No. 46 of 2021 on Electronic Transactions and Trust Services and the Saudi Electronic Transactions Law.",
      ] },
      { h: "11. Law and disputes", p: [
        `These terms are governed by ${c.law}. Disputes go to ${c.courts}, unless consumer law gives you the right to bring a claim where you live. If the Arabic and English versions differ, the Arabic version prevails where required by law.`,
      ] },
      { h: "12. Contact", p: [`${c.name}, ${c.licence}, ${c.address}. Email: ${c.email}. Last updated: ${c.updated}.`] },
    ],
  },
  refund: {
    title: "Refund policy",
    intro: "We want you to be confident before paying. This policy explains when you can cancel and get money back. It applies together with your rights under UAE consumer protection law, the Saudi E-Commerce Law and other GCC consumer laws.",
    sections: [
      { h: "1. Free trial first", p: ["Every account gets 10 free leads after email confirmation, so you can judge the quality before you subscribe."] },
      { h: "2. Cancelling a subscription", p: [
        "You can cancel your plan at any time by emailing " + c.email + ". Cancellation stops the next renewal. You keep access until the end of the period you paid for.",
      ] },
      { h: "3. When we refund", p: [
        "Within 7 days of your first payment, if you have used fewer than 10 leads of the paid plan, we refund the full payment.",
        "If a technical fault on our side stopped you from receiving leads you paid for, we will add the missing leads or refund that part, at your choice.",
        "If we end the service, we refund any unused prepaid period.",
        "Duplicate or mistaken charges are always refunded in full.",
      ] },
      { h: "4. When we do not refund", p: [
        "Leads that have already been delivered are a digital service that has been performed, so they are not refundable, except as set out above or where the law requires.",
        "Unused leads at the end of a month, and accounts closed for breaking the Terms of service.",
      ] },
      { h: "5. Lead quality", p: [
        "If a lead is clearly wrong (for example, the business does not exist or the phone belongs to another business), tell us within 14 days with the lead name. We will replace it with a credit for one new lead.",
      ] },
      { h: "6. How refunds are paid", p: [
        "Refunds go back to the original payment method (card or bank account) within 14 days of approval. Your bank may take a few more days to show it.",
      ] },
      { h: "7. Contact", p: [`Email ${c.email} with your account email and the reason. ${c.name}, ${c.address}. Last updated: ${c.updated}.`] },
    ],
  },
};

const ar: Record<DocKey, LegalDoc> = {
  privacy: {
    title: "سياسة الخصوصية",
    intro: `توضح هذه السياسة كيف تجمع ${c.name} ("مسار"، "نحن") البيانات الشخصية وتستخدمها عند استخدامك موقع وخدمة مسار. نلتزم بقانون حماية البيانات الشخصية في دولة الإمارات (المرسوم بقانون اتحادي رقم 45 لسنة 2021)، ونظام حماية البيانات الشخصية في المملكة العربية السعودية (المرسوم الملكي رقم م/19 لعام 1443هـ وتعديلاته)، وقوانين حماية البيانات في دول الخليج الأخرى التي يقيم فيها مستخدمونا.`,
    sections: [
      { h: "1. الجهة المسؤولة", p: [
        `${c.name}، ${c.licence}، ${c.address}، هي المتحكم في بيانات حسابك. للتواصل: ${c.privacyEmail}.`,
        "بالنسبة لبيانات العملاء المحتملين التي تنزّلها وتستخدمها، تصبح أنت متحكمًا مستقلًا ومسؤولًا عن طريقة استخدامها (انظر البند 6).",
      ] },
      { h: "2. البيانات التي نجمعها عنك", p: [
        "بيانات الحساب: بريدك الإلكتروني، وكلمة المرور (تُحفظ فقط بشكل مشفّر لدى مزوّد تسجيل الدخول)، وتواريخ التسجيل والتأكيد.",
        "بيانات الخدمة: عمليات البحث التي تجريها (ما تبيعه، العميل المستهدف، المدن)، والنتائج التي نعيدها لك، وباقتك، وعدد العملاء المستخدمين.",
        "البيانات التقنية: ملفات تعريف الارتباط الخاصة بجلسة الدخول، وعنوان IP، والسجلات الأساسية اللازمة لحماية الخدمة.",
        "بيانات الاستخدام: الصفحات التي تزورها والأزرار التي تستخدمها في موقع مسار، لفهم طريقة استخدام الخدمة وتحسينها.",
        "بيانات الدفع: عند الاشتراك يتم الدفع عبر مزوّد الدفع أو التحويل البنكي. نحتفظ بسجل الفاتورة فقط، وليس ببيانات بطاقتك كاملة.",
      ] },
      { h: "3. البيانات الواردة في نتائج العملاء المحتملين", p: [
        "يبحث مسار في مصادر عامة (قوائم خرائط Google، ومواقع الأنشطة التجارية، وصفحات إنستغرام وفيسبوك ولينكدإن العامة) عن بيانات التواصل التجارية: اسم النشاط، والعنوان، وهاتف وبريد النشاط، والموقع الإلكتروني، والحسابات العامة، وأسماء ومسميات الأشخاص في الأدوار التجارية العامة.",
        "لا نسجّل الدخول إلى أي منصة، ولا نتجاوز أي قيود وصول، ولا نجمع الرسائل الخاصة، أو أرقام الجوال الشخصية غير المنشورة لأغراض تجارية، أو أرقام الهوية، أو البيانات الصحية أو أي بيانات حساسة.",
        "كل معلومة في النتائج مرتبطة بالصفحة العامة التي جاءت منها. لا نحتفظ بقاعدة بيانات منفصلة عن الأشخاص الواردين في نتائجك إلا بقدر ما يلزم لتقديم البحث.",
      ] },
      { h: "4. أسباب استخدام بياناتك (الأساس النظامي)", p: [
        "لتقديم الخدمة التي اشتركت فيها (تنفيذ العقد): حسابك، وعمليات البحث، والنتائج، والتجربة المجانية، والباقة.",
        "لحماية الخدمة ومنع إساءة الاستخدام (المصلحة المشروعة والالتزام النظامي).",
        "لإرسال رسائل الخدمة مثل التأكيد واستعادة كلمة المرور وتغييرات الباقة. لا نرسل رسائل تسويقية إلا بموافقتك، ويمكنك إلغاء الاشتراك في أي وقت.",
        "تُعالج بيانات التواصل التجارية في النتائج لأغراض التسويق بين الشركات على أساس المصلحة المشروعة، وتقتصر على ما نشره النشاط أو الشخص لأغراض تجارية.",
      ] },
      { h: "5. مع من نشارك البيانات", p: [
        "Supabase (تسجيل الدخول وقاعدة البيانات)، وVercel (استضافة الموقع)، وAnthropic (البحث بالذكاء الاصطناعي في الصفحات العامة؛ يُرسل إليها نص البحث لتنفيذه)، وGoogle (البحث في الخرائط عند تفعيله)، وPostHog (تحليلات الموقع)، وSentry (تقارير الأخطاء، دون عناوين IP)، ومزوّد الدفع.",
        "يعالج هؤلاء المزوّدون البيانات نيابة عنا بموجب شروط مكتوبة. لا نبيع بياناتك الشخصية.",
        "قد نفصح عن البيانات إذا طلب ذلك القانون أو جهة مختصة في الإمارات أو السعودية أو أي دولة خليجية أخرى.",
      ] },
      { h: "6. مسؤولياتك عند استخدام النتائج", p: [
        "يجب أن تستخدم النتائج فقط للتواصل المشروع بين الشركات، وأن تلتزم بالأنظمة المطبقة عليك، بما في ذلك قواعد هيئة تنظيم الاتصالات والحكومة الرقمية في الإمارات بشأن الرسائل التسويقية غير المرغوبة، وقواعد هيئة الاتصالات والفضاء والتقنية في السعودية بشأن الرسائل التسويقية، وأنظمة حماية البيانات.",
        "توقف عن التواصل مع أي شخص يطلب ذلك، واحتفظ بقائمة لطلبات الإلغاء، ولا تستخدم النتائج للرسائل المزعجة أو المضايقة أو إعادة بيعها كقوائم اتصال.",
      ] },
      { h: "7. نقل البيانات خارج الدولة", p: [
        "يخزّن بعض المزوّدين البيانات أو يعالجونها خارج دولتك (مثل الاتحاد الأوروبي أو الولايات المتحدة). نستخدم فقط مزوّدين يقدمون ضمانات مناسبة، مثل الحماية التعاقدية، وفقًا للمادتين 22 و23 من القانون الإماراتي ولوائح النقل في السعودية.",
      ] },
      { h: "8. مدة الاحتفاظ بالبيانات", p: [
        "بيانات الحساب: طوال فترة فتح الحساب وحتى 12 شهرًا بعد إغلاقه، ما لم يتطلب القانون مدة أطول (مثل الاحتفاظ بالفواتير حسب أنظمة الضرائب).",
        "تُحفظ نتائج البحث في متصفحك. وتُحفظ سجلات الخادم حتى 90 يومًا.",
      ] },
      { h: "9. حقوقك", p: [
        "بحسب مكان إقامتك، يحق لك طلب الاطلاع على بياناتك أو تصحيحها أو حذفها أو الحصول على نسخة منها، وتقييد المعالجة أو الاعتراض عليها، وسحب موافقتك. راسلنا على " + c.privacyEmail + "، ونرد خلال 30 يومًا.",
        "إذا كنت صاحب نشاط أو موظفًا ظهرت بياناتك في النتائج وترغب في حذفها أو تصحيحها، راسلنا وسنتخذ الإجراء اللازم.",
        "يمكنك أيضًا تقديم شكوى إلى جهة حماية البيانات، مثل مكتب البيانات في الإمارات أو الهيئة السعودية للبيانات والذكاء الاصطناعي (سدايا).",
      ] },
      { h: "10. أمن البيانات", p: [
        "نستخدم اتصالات مشفّرة (HTTPS)، وكلمات مرور مشفّرة، وضوابط وصول في قاعدة البيانات بحيث لا يرى المستخدم إلا حسابه، ونحتفظ بمفاتيح API على الخادم فقط.",
        "في حال حدوث اختراق يؤثر على بياناتك الشخصية، سنبلغك ونبلغ الجهة المختصة وفق ما يتطلبه القانون.",
      ] },
      { h: "11. ملفات تعريف الارتباط", p: ["نستخدم الملفات اللازمة لإبقائك مسجلًا للدخول وتذكّر لغتك، وملف تحليلات من PostHog يحسب الزيارات ويوضح لنا الأجزاء المستخدمة من الموقع. لا نستخدم ملفات إعلانية."] },
      { h: "12. القاصرون", p: ["مسار خدمة للأعمال وغير مخصصة لمن هم دون 18 عامًا."] },
      { h: "13. التعديلات", p: [`ننشر أي تعديل في هذه الصفحة، ونرسل لك بريدًا عند التعديلات المهمة. آخر تحديث: ${c.updated}.`] },
    ],
  },
  terms: {
    title: "شروط الاستخدام",
    intro: `هذه الشروط اتفاقية بينك وبين ${c.name} ("مسار"، "نحن") لاستخدام موقع وخدمة مسار. بإنشائك حسابًا فإنك توافق عليها. إذا كنت تستخدم مسار نيابة عن شركة، فإنك تؤكد أن لديك صلاحية قبول هذه الشروط عنها.`,
    sections: [
      { h: "1. الخدمة", p: [
        "يجد مسار العملاء المحتملين من الأنشطة التجارية عبر مصادر عامة، ويتحقق من بيانات التواصل العامة وحضورهم الرقمي، ويعطي كل عميل نسبة توافق واحتمالًا تقديريًا للإغلاق.",
        "التقييمات والفحوصات تقديرات يجريها برنامج، بما في ذلك الذكاء الاصطناعي، وليست ضمانات. قد تتغير بيانات الأنشطة أو تكون قديمة أو غير دقيقة. تحقق دائمًا قبل الاعتماد على أي عميل.",
      ] },
      { h: "2. الحسابات", p: [
        "يجب تقديم بريد إلكتروني صحيح وتأكيده، وأن يكون عمرك 18 عامًا على الأقل، وأن تستخدم الخدمة لأغراض تجارية.",
        "حافظ على سرية كلمة المرور، فأنت مسؤول عن النشاط في حسابك. تجربة مجانية واحدة لكل شخص أو نشاط.",
      ] },
      { h: "3. الباقات والرصيد", p: [
        "التجربة المجانية: 10 عملاء، تُمنح مرة واحدة بعد تأكيد بريدك.",
        "الباقة الأساسية: 300 عميل لكل شهر (30 يومًا) طوال مدة الاشتراك، ويستهلك كل عميل رصيدًا واحدًا. الرصيد غير المستخدم لا يُرحّل للشهر التالي.",
        "باقة بريميوم: كل ما في الأساسية، مع عملاء بلا حدود عبر مسار CLI.",
        "يُستهلك عميل واحد في كل مرة ينتهي فيها مسار من التحقق من نشاط لك. تُعرض الأسعار وتفاصيل الباقة قبل الدفع، وقد تتغير للفترات القادمة مع إشعار مسبق.",
      ] },
      { h: "4. الاستخدام المقبول", p: [
        "يجوز استخدام النتائج فقط للتواصل المشروع بين الشركات. يُحظر: إرسال الرسائل المزعجة أو الجماعية غير المرغوبة، والمضايقة، وإعادة بيع القوائم أو نشرها، واستخدامها في الاحتيال أو التمييز أو أي غرض غير مشروع، ومحاولة تعطيل الخدمة أو إثقالها أو نسخها أو الهندسة العكسية لها.",
        "يجب الالتزام بالأنظمة المطبقة على تواصلك، بما فيها المرسوم بقانون اتحادي رقم 45 لسنة 2021 بشأن حماية البيانات الشخصية، والمرسوم بقانون اتحادي رقم 34 لسنة 2021 بشأن مكافحة الشائعات والجرائم الإلكترونية، وقواعد هيئة تنظيم الاتصالات بشأن الرسائل غير المرغوبة في الإمارات، ونظام حماية البيانات الشخصية ونظام مكافحة الجرائم المعلوماتية وقواعد هيئة الاتصالات والفضاء والتقنية في السعودية.",
        "يحق لنا إيقاف أو إغلاق الحسابات المخالفة لهذه القواعد دون استرداد عن فترة المخالفة.",
      ] },
      { h: "5. البيانات والخصوصية", p: ["توضح سياسة الخصوصية كيفية تعاملنا مع البيانات الشخصية. عند تنزيل النتائج، تكون مسؤولًا عن استخدامها وفق أنظمة حماية البيانات، بما في ذلك الالتزام بطلبات إيقاف التواصل."] },
      { h: "6. الملكية الفكرية", p: ["برنامج مسار وعلامته وتصميمه ملك لنا. أنت تملك مدخلات بحثك، ويحق لك استخدام النتائج لنشاطك التجاري. البيانات العامة في النتائج ملك لأصحابها."] },
      { h: "7. خدمات الأطراف الأخرى", p: ["يعتمد مسار على خدمات أطراف أخرى (مثل Google وAnthropic وSupabase وVercel) وعلى مواقع عامة، ولسنا مسؤولين عن توفرها أو محتواها."] },
      { h: "8. المسؤولية", p: [
        "تُقدَّم الخدمة \"كما هي\". وبالقدر الذي يسمح به القانون، لا نتحمل المسؤولية عن الخسائر غير المباشرة أو التبعية أو فوات الأرباح أو الصفقات، ويقتصر إجمالي مسؤوليتنا خلال أي 12 شهرًا على المبلغ الذي دفعته لنا خلال تلك الفترة.",
        "لا يحدّ أي شيء في هذه الشروط من حقوقك التي لا يجوز استبعادها بموجب قوانين حماية المستهلك، بما فيها القانون الاتحادي رقم 15 لسنة 2020 بشأن حماية المستهلك في الإمارات ونظام التجارة الإلكترونية في السعودية.",
      ] },
      { h: "9. إنهاء الخدمة", p: ["يمكنك إغلاق حسابك في أي وقت بمراسلتنا. ويحق لنا إنهاء الخدمة بإشعار مدته 30 يومًا، ونرد في هذه الحالة قيمة أي فترة مدفوعة غير مستخدمة."] },
      { h: "10. السجلات الإلكترونية", p: ["توافق على أن تُقدَّم هذه الشروط والإشعارات والفواتير إلكترونيًا، ويكون لها الأثر ذاته للمستندات الورقية بموجب المرسوم بقانون اتحادي رقم 46 لسنة 2021 بشأن المعاملات الإلكترونية وخدمات الثقة ونظام التعاملات الإلكترونية في السعودية."] },
      { h: "11. القانون الواجب التطبيق وحل النزاعات", p: [`تخضع هذه الشروط لـ ${c.law}، وتختص ${c.courts} بالنزاعات، ما لم يمنحك قانون حماية المستهلك حق رفع الدعوى في بلد إقامتك. عند اختلاف النسختين العربية والإنجليزية، تُعتمد النسخة العربية حيثما يتطلب القانون ذلك.`] },
      { h: "12. التواصل", p: [`${c.name}، ${c.licence}، ${c.address}. البريد: ${c.email}. آخر تحديث: ${c.updated}.`] },
    ],
  },
  refund: {
    title: "سياسة الاسترداد",
    intro: "نريدك أن تكون واثقًا قبل الدفع. توضح هذه السياسة متى يمكنك الإلغاء واسترداد المبلغ، وتُطبق مع حقوقك بموجب قانون حماية المستهلك في الإمارات ونظام التجارة الإلكترونية في السعودية وأنظمة حماية المستهلك في دول الخليج الأخرى.",
    sections: [
      { h: "1. التجربة المجانية أولًا", p: ["يحصل كل حساب على 10 عملاء مجانًا بعد تأكيد البريد، لتقييم الجودة قبل الاشتراك."] },
      { h: "2. إلغاء الاشتراك", p: ["يمكنك إلغاء باقتك في أي وقت بمراسلة " + c.email + ". يوقف الإلغاء التجديد التالي، ويبقى وصولك قائمًا حتى نهاية الفترة المدفوعة."] },
      { h: "3. متى نرد المبلغ", p: [
        "خلال 7 أيام من أول دفعة، إذا استخدمت أقل من 10 عملاء من الباقة المدفوعة، نرد المبلغ كاملًا.",
        "إذا منعك عطل تقني من جهتنا من الحصول على عملاء دفعت ثمنهم، نضيف العملاء الناقصين أو نرد قيمتهم، حسب اختيارك.",
        "إذا أنهينا الخدمة، نرد قيمة أي فترة مدفوعة غير مستخدمة.",
        "تُرد المبالغ المكررة أو المخصومة بالخطأ كاملة دائمًا.",
      ] },
      { h: "4. متى لا نرد المبلغ", p: [
        "العملاء الذين تم تسليمهم خدمة رقمية تم تنفيذها، لذا لا تُسترد قيمتهم إلا وفق ما سبق أو حيث يتطلب القانون ذلك.",
        "الرصيد غير المستخدم في نهاية الشهر، والحسابات المغلقة بسبب مخالفة شروط الاستخدام.",
      ] },
      { h: "5. جودة العملاء", p: ["إذا كان أحد العملاء خاطئًا بوضوح (مثل نشاط غير موجود أو رقم يعود لنشاط آخر)، أبلغنا خلال 14 يومًا باسم العميل، وسنعوضك برصيد عميل جديد."] },
      { h: "6. طريقة الاسترداد", p: ["يُعاد المبلغ إلى وسيلة الدفع الأصلية (البطاقة أو الحساب البنكي) خلال 14 يومًا من الموافقة، وقد يستغرق ظهوره لدى بنكك بضعة أيام إضافية."] },
      { h: "7. التواصل", p: [`راسلنا على ${c.email} مع بريد حسابك وسبب الطلب. ${c.name}، ${c.address}. آخر تحديث: ${c.updated}.`] },
    ],
  },
};

export const LEGAL: Record<Lang, Record<DocKey, LegalDoc>> = { en, ar };
