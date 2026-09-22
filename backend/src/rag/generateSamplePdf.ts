import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const OUT_PATH = path.join(DATA_DIR, "policy.pdf");

fs.mkdirSync(DATA_DIR, { recursive: true });

const SECTIONS: { heading: string; body: string }[] = [
  {
    heading: "POLICY OVERVIEW",
    body:
      "This is the HealthSecure Individual Policy (Plan Code HS-2024-IND), a comprehensive " +
      "health insurance policy issued to the named policyholder. The policy provides coverage " +
      "for hospitalization, day-care procedures, and pre/post-hospitalization expenses as " +
      "detailed in this document. The sum insured for this policy is INR 5,00,000 per policy year.",
  },
  {
    heading: "COVERAGE",
    body:
      "The policy covers in-patient hospitalization expenses including room rent up to 2% of " +
      "sum insured per day, ICU charges up to 4% of sum insured per day, surgeon and " +
      "anesthetist fees, cost of medicines and consumables, and diagnostic tests directly " +
      "related to the hospitalization. Day-care procedures not requiring 24-hour " +
      "hospitalization, such as cataract surgery and dialysis, are covered in full. " +
      "Pre-hospitalization expenses incurred up to 30 days before admission and " +
      "post-hospitalization expenses incurred up to 60 days after discharge are covered.",
  },
  {
    heading: "WAITING PERIODS",
    body:
      "There is an initial waiting period of 30 days from the policy start date during which " +
      "no claims are payable except for accidental hospitalization. Pre-existing diseases " +
      "declared at the time of purchase are covered after a waiting period of 36 months of " +
      "continuous coverage. Specific illnesses including cataract, hernia, and joint " +
      "replacement surgeries have a waiting period of 24 months.",
  },
  {
    heading: "EXCLUSIONS",
    body:
      "This policy does not cover cosmetic or plastic surgery unless required due to an " +
      "accident, dental treatment unless requiring hospitalization due to an accident, " +
      "treatment for infertility or maternity except where a maternity add-on has been " +
      "separately purchased, self-inflicted injury, and treatment taken outside India. War " +
      "and nuclear-related injuries are also excluded.",
  },
  {
    heading: "CLAIMS PROCESS",
    body:
      "For cashless treatment at a network hospital, the policyholder or hospital must " +
      "notify the insurer at least 48 hours before a planned admission, or within 24 hours " +
      "of admission in an emergency, by calling the claims helpline or using the mobile app. " +
      "For reimbursement claims at non-network hospitals, the policyholder must submit the " +
      "claim form along with original bills, discharge summary, and investigation reports " +
      "within 30 days of discharge. Claims are typically processed within 15 working days " +
      "of receipt of complete documentation.",
  },
  {
    heading: "PREMIUM AND RENEWAL",
    body:
      "The annual premium for this policy is INR 12,500, payable in full at the start of each " +
      "policy year. The policy is renewable for life, subject to timely payment of premium, " +
      "with a grace period of 30 days after the due date. A no-claim bonus of 10% of the sum " +
      "insured is added for each claim-free year, up to a maximum of 50%.",
  },
];

const doc = new PDFDocument({ margin: 60 });
const writeStream = fs.createWriteStream(OUT_PATH);
doc.pipe(writeStream);

doc.fontSize(20).text("HealthSecure Individual Policy", { align: "center" });
doc.moveDown(1.5);

for (const section of SECTIONS) {
  doc.fontSize(14).text(section.heading.toUpperCase(), { underline: false });
  doc.moveDown(0.4);
  doc.fontSize(11).text(section.body, { align: "left" });
  doc.moveDown(1.2);
}

doc.end();

await new Promise<void>((resolve, reject) => {
  writeStream.on("finish", () => resolve());
  writeStream.on("error", reject);
});

console.log(`Sample policy PDF written to ${OUT_PATH}`);
