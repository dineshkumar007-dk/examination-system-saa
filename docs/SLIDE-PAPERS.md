# Original-slide examination papers

New uploads display rendered PowerPoint slides with a separate answer panel. Question text recognition and extraction issue resolutions are not part of this workflow. Keys remain manually entered and server-only.

1. Apply `npm run db:migrate` through migration `009_slide_papers.sql` before running or deploying this version. Use Node 24 (minimum 22.18).
2. Examiner uploads a PPTX (up to 3 MB / 300 slides). Each slide initially creates one MCQ with A–D choices and one mark. No slide text is interpreted as a key.
3. In Question Preview, inspect the rendered images, choose source slides and option counts, set marks, remove questions for title/instruction slides, or add a question for a slide containing several questions. Set total marks to the sum of question marks.
4. Enter the answer key, confirm slide/settings/key review, save and publish. There are no unassigned-text warnings or extraction review notes.
5. For an existing unpublished upload, select Question Preview → Use original slides. This replaces its previous question settings and keys after confirmation. Re-enter the key. Published historical papers remain immutable and retain their original exam format.
6. Candidates see the slide image with separate choices, saved responses, timer and existing submission behavior. Images require the candidate's current admitted attempt and authorized workstation. They cannot fetch another exam's slides or the original PPTX, speaker notes or keys.

Slides render server-side to PNG using the MIT-licensed `@office-kit/pptx` and `@office-kit/pptx-preview` packages. A bounded worker performs rendering; output is stored privately in MySQL, separately from draft JSON. No Office viewer, public upload URL, external conversion service or LibreOffice installation is required for PPTX. Legacy `.ppt` still requires the configured LibreOffice converter, or Save As PPTX.

The renderer uses bundled substitute fonts and static slide images. Animations, video and complex PowerPoint features may differ from desktop PowerPoint. Inspect every rendered slide before publication. Uploads fail explicitly if conversion times out or exceeds the image limits (2 MB per slide, 24 MB per presentation); split or compress those presentations. Vercel packaging includes the rendering worker and font files; verify a slide-upload smoke test after deployment.

Validation: production build, application-scoped ESLint, 62 unit/mocked tests, and the real isolated MySQL + HTTP upload/publication/admitted-candidate/slides/answer-saving/grading workflow passed. The migration has been applied to the isolated upgrade test database. Apply it separately to the deployed database before deploying this version.
