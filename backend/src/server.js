import { app } from "./app.js";
app.listen(Number(process.env.PORT || 3000), () =>
  console.log(
    "EXAMPRO is listening. Configure the database and providers before registering.",
  ),
);
