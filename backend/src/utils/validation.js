import { z } from "zod";
export const id = z.string().uuid();
export const email = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
export const password = z
  .string()
  .min(12)
  .max(72)
  .refine(
    (value) => Buffer.byteLength(value) <= 72,
    "Password must be at most 72 bytes",
  );
export const phone = z
  .string()
  .regex(
    /^\+[1-9]\d{7,14}$/,
    "Use international format, such as +919876543210",
  );
export const code = z.string().regex(/^\d{6}$/, "Enter the six-digit code");
export const staffCreate = z
  .object({
    name: z.string().trim().min(2).max(120),
    email,
    role: z.enum(["invigilator", "examiner"]),
    centerId: id.nullable(),
    password,
    confirmPassword: z.string(),
  })
  .strict()
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords must match",
  })
  .refine((data) => data.role !== "invigilator" || !!data.centerId, {
    path: ["centerId"],
    message: "Invigilators require an assigned center",
  });
export const signup = z
  .object({
    name: z.string().trim().min(2).max(120),
    email,
    phone,
    password,
    confirmPassword: z.string(),
    dob: z.iso
      .date()
      .refine(
        (v) => v <= new Date().toISOString().slice(0, 10),
        "Date of birth cannot be in the future",
      ),
    address: z.string().trim().min(5).max(500),
    examId: id.optional(),
  })
  .strict()
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords must match",
  });
export const examInput = z
  .object({
    name: z.string().trim().min(3).max(150),
    description: z.string().max(2000),
    instructions: z.string().min(10).max(5000),
    durationMinutes: z.coerce.number().int().min(1).max(360),
    registrationStart: z.iso.datetime(),
    registrationEnd: z.iso.datetime(),
    fee: z.coerce.number().min(0).max(100000),
    status: z.enum(["draft", "open", "closed", "active", "completed"]),
  })
  .strict()
  .refine(
    (d) => d.registrationEnd > d.registrationStart,
    "Registration end must follow start",
  );
export const centerInput = z
  .object({
    name: z.string().min(2).max(150),
    address: z.string().min(5).max(500),
    city: z.string().min(2).max(100),
    state: z.string().min(2).max(100),
    capacity: z.coerce.number().int().min(1).max(5000),
    active: z.boolean(),
  })
  .strict();
export const slotInput = z
  .object({
    examId: id,
    centerId: id,
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    capacity: z.coerce.number().int().min(1).max(5000),
  })
  .strict()
  .refine((d) => d.endsAt > d.startsAt, "End must follow start");
export const questionInput = z
  .object({
    examId: id,
    type: z.enum(["MCQ", "MSQ", "NAT"]),
    prompt: z.string().min(5).max(10000),
    options: z
      .array(
        z.object({
          id: z.string().regex(/^[A-H]$/),
          text: z.string().min(1).max(2000),
        }),
      )
      .max(8),
    correctAnswer: z.union([z.array(z.string().regex(/^[A-H]$/)), z.number()]),
    tolerance: z.coerce.number().min(0).max(100).default(0),
    marks: z.coerce.number().positive().max(100),
    negativeMarks: z.coerce.number().min(0).max(100),
    position: z.coerce.number().int().min(1).max(500),
  })
  .strict()
  .superRefine((d, ctx) => {
    const choices = d.options.map((o) => o.id);
    if (new Set(choices).size !== choices.length)
      ctx.addIssue({ code: "custom", message: "Option IDs must be unique" });
    if (d.type === "NAT") {
      if (typeof d.correctAnswer !== "number" || d.options.length)
        ctx.addIssue({
          code: "custom",
          message: "NAT requires a numeric key and no options",
        });
    } else if (
      !Array.isArray(d.correctAnswer) ||
      !d.correctAnswer.length ||
      d.options.length < 2 ||
      d.correctAnswer.some((v) => !choices.includes(v)) ||
      new Set(d.correctAnswer).size !== d.correctAnswer.length ||
      (d.type === "MCQ" && d.correctAnswer.length !== 1)
    )
      ctx.addIssue({
        code: "custom",
        message: "Choose valid answer keys for this question type",
      });
  });
export function parse(schema, body) {
  return schema.parse(body);
}
