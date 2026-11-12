import PDFDocument from "pdfkit";
export async function pdfFixture({ pages = 2, encrypted = false } = {}) {
  const pdf = new PDFDocument(
    encrypted
      ? { userPassword: "private-password", ownerPassword: "owner-password" }
      : {},
  );
  const chunks = [];
  pdf.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    pdf.on("end", resolve);
    pdf.on("error", reject);
  });
  for (let i = 0; i < pages; i++) {
    if (i) pdf.addPage();
    pdf.fontSize(20).text(`Question ${i + 1}: What is two plus two?`);
    pdf.fontSize(14).text("A. Four     B. Five     C. Six     D. Seven");
    pdf.rect(80, 180, 120, 80).fill("#7755AA");
  }
  pdf.end();
  await done;
  return Buffer.concat(chunks);
}
