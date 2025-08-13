import { useNavigate, Link } from "react-router";
import { useForm } from "react-hook-form";
import { authClient } from "../lib/auth-client";
import { type Credentials } from "../validation/auth-validation";
import { delay } from "~/utils";
import { useState } from "react";
import { BarLoader } from "react-spinners";

export default function Login() {
  const nav = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<Credentials>();

  const [waiting, setWaiting] = useState<boolean>(false);

  const onSubmit = async (data: Credentials) => {
    setWaiting(true);
    const { error } = await authClient.signIn.email(
      { ...data, callbackURL: "/dashboard" }
    );
    // setWaiting(false);
    if (error) {
      // react-hook-form friendly field error
      setError("root", { message: error.message });
    } else {
      // nav("/dashboard");
    }
  };

  const InputBox = ({ type, placeholder, name }: React.InputHTMLAttributes<HTMLInputElement>) => {
    return (
      <div className="mb-6">
        <input
          type={type}
          placeholder={placeholder}
          className="w-full rounded-md border border-stroke bg-transparent px-5 py-3 text-base text-body-color outline-none focus:border-blue-500 focus-visible:shadow-none  "
          {...register(name as "email" | "password")}
        />
      </div>
    );
  };

  const Form = (<form onSubmit={handleSubmit(onSubmit)}>
    <InputBox type="email" placeholder="Email" name="email"></InputBox>
    {errors.email && <span>{errors.email.message}</span>}

    <InputBox type="password" placeholder="Password" name="password"></InputBox>
    {errors.password && <span>{errors.password.message}</span>}

    {errors.root && <p className="error">{errors.root.message}</p>}
    
    {waiting ? <div className="flex flex-row justify-between items-center w-full">
      <BarLoader></BarLoader>
      <span>trying to log you in...</span>
    </div> : ""}
    <button disabled={isSubmitting} className="w-full cursor-pointer rounded-md border border-blue-500 bg-blue-500 px-5 py-3 text-base font-medium text-white transition hover:bg-opacity-90">Log in</button>
  </form>
  )

  return <section className="bg-gray-1 ">
    <div className="container mx-auto">
      <div className="-mx-4 flex flex-wrap">
        <div className="w-full px-4">
          <div className="relative mx-auto max-w-[525px] overflow-hidden rounded-lg bg-white px-10 py-16 text-center  sm:px-12 md:px-[60px]">
            {Form}
            <p className="mt-3 text-base text-body-color ">
              <span className="pr-0.5">Not have an account? </span>
              <Link to="/signup" className="text-blue-500 hover:underline">Sign up</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>;
}

