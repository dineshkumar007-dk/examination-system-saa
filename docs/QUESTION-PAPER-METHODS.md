# Two ways to create a question paper

An assigned Examiner opens **Create Question Paper**, selects an examination, and chooses a method before creating the draft.

## Upload PDF or PowerPoint

Upload a PDF or PPTX up to 3 MB. PDF files may contain up to 100 pages; PowerPoint files may contain up to 300 slides. Password-protected PDFs are rejected. The server renders each page/slide as a private image, preserving its original layout and diagrams. Each initially has one question with A–D response choices. Skip cover pages or add multiple questions for the same page, choose the response letters and marks, and enter the correct answers in **Answer Key Entry**.

Legacy `.ppt` keeps its existing converter requirement. On Vercel, save the file as `.pptx` before uploading. Original files and page images remain restricted to the owning assigned Examiner; candidates receive only the images for questions in their own currently admitted attempt.

## Type questions manually

Choose **Type questions manually**, create the draft, and select **Add question**. Enter the full question text, 2–8 answer options, the correct answer, marks, and optional negative marks. Options and questions can be added or removed. Removing the selected correct option clears the key so it must be chosen again. Drafts can be saved incomplete and reopened later.

Manually typed papers do not require a source file. They use the same MCQ publication, student answer saving, and grading workflow. Both methods require complete questions/options, explicit correct answers, matching total marks, and an Examiner review check before publication. Published papers are locked, and examinations with existing attempts cannot have their questions replaced.

## Compatibility and verification

No new database migration is needed beyond the existing `009_slide_papers.sql`: the authoring method is stored in the paper document JSON. Existing uploaded papers retain their format and original page assets.

PDF parsing and native graphics remain lazy-loaded inside a resource-limited rendering worker, with a 35-second deadline, bounded page dimensions and output sizes. Authentication/dashboard startup does not load these libraries. Vercel includes the PDF worker, CMaps, fonts and WASM data.

Validation covers generated multi-page PDFs, encrypted/malformed/oversized/too-many-page rejection, manual answer-key and total-mark checks, and a real isolated MySQL/HTTP workflow for draft save, revision conflicts, publication and Examiner/candidate isolation. Browser QA confirmed typed questions, option changes, saving and reopening the draft. No real student or examination records were used for these checks.
