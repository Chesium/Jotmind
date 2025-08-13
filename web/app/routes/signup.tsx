import { useNavigate, Link } from "react-router";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { authClient } from "../lib/auth-client";
import { useState } from "react";
import { BarLoader } from "react-spinners";

// re-use credential fields + confirm
const signUpSchema = z
  .object({
    name: z.string(),
    email: z.email(),
    password: z.string().min(6),
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, {
    message: "Passwords do not match",
    path: ["confirm"],
  });

type SignUpForm = z.infer<typeof signUpSchema>;

export default function SignUpPage() {
  const nav = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<SignUpForm>({ resolver: zodResolver(signUpSchema) });
  
  const [waiting, setWaiting] = useState<boolean>(false);

  const onSubmit = async ({ name, email, password }: SignUpForm) => {
    setWaiting(true);
    const { error } = await authClient.signUp.email(
      { name, email, password, callbackURL: "/dashboard" } // Better-Auth call
    );
    // setWaiting(false);
    if (error) {
      setError("root", { message: error.message });
    } else {
      // Better-Auth auto-logs in by default; if not, call signIn then nav
      nav("/dashboard");
    }
  };

  const InputBox = ({ type, placeholder, name }: React.InputHTMLAttributes<HTMLInputElement>) => {
    return (
      <div className="mb-6">
        <input
          type={type}
          placeholder={placeholder}
          className="w-full rounded-md border border-stroke bg-transparent px-5 py-3 text-base text-body-color outline-none focus:border-blue-500 focus-visible:shadow-none"
          {...register(name as "name" | "email" | "password" | "confirm")}
        />
      </div>
    );
  };
  
  const Form = (<form onSubmit={handleSubmit(onSubmit)}>
    <InputBox type="name" placeholder="Name" name="name"></InputBox>
    {errors.name && <span>{errors.name.message}</span>}

    <InputBox type="email" placeholder="Email" name="email"></InputBox>
    {errors.email && <span>{errors.email.message}</span>}

    <InputBox type="password" placeholder="Password" name="password"></InputBox>
    {errors.password && <span>{errors.password.message}</span>}

    <InputBox type="confirm" placeholder="Confirm Password" name="confirm"></InputBox>
    {errors.confirm && <span>{errors.confirm.message}</span>}

    {errors.root && <p className="error">{errors.root.message}</p>}
    {waiting ? <div className="flex flex-row justify-between items-center w-full">
      <BarLoader></BarLoader>
      <span>trying to log you in...</span>
    </div> : ""}
    <button disabled={isSubmitting} className="w-full cursor-pointer rounded-md border border-blue-500 bg-blue-500 px-5 py-3 text-base font-medium text-white transition hover:bg-opacity-90">Sign&nbsp;up</button>
  </form>
  )

  return <section className="bg-gray-1">
    <div className="container mx-auto">
      <div className="-mx-4 flex flex-wrap">
        <div className="w-full px-4">
          <div className="relative mx-auto max-w-[525px] overflow-hidden rounded-lg bg-white px-10 py-16 text-center sm:px-12 md:px-[60px]">
            <div className="mb-10 text-center md:mb-16">
            </div>
            {Form}
            <p className="mt-3 text-base text-body-color">
              <span className="pr-0.5">Already have an account? </span>
              <Link to="/login" className="text-blue-500 hover:underline">Log in</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>;
}
