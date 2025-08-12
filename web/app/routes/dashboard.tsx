import { Navigate, useNavigate } from "react-router";
import { authClient } from "../lib/auth-client";

export default function Dashboard() {

  const nav = useNavigate();
  // auto-refreshes when user logs in/out thanks to useSession
  const sessionRaw = authClient.useSession(); // hook from docs
  const { data: session, isPending } = sessionRaw;
  if (isPending) return <p>…loading</p>;
  if (!session) return <Navigate to="/login" />;

  async function logOut() {
    await authClient.signOut(
      {
        fetchOptions: {
          onSuccess: () => {
            nav("/login"); // redirect to login page
          },
        }
      })
  }

  return (

    <div className="container mx-auto">
      <div className="-mx-4 flex flex-wrap">
        <div className="w-full px-4">
          <div className="relative mx-auto max-w-[525px] overflow-hidden rounded-lg bg-white px-10 py-16 text-center sm:px-12 md:px-[60px]">

            <h2>Hello, {session.user.name}</h2>
            <p>Your email: {session.user.email}</p>
            <p>session.Neo4jDb: {(session as any).neo4jDb}</p>

            <button onClick={logOut} className="w-full cursor-pointer rounded-md border border-blue-500 bg-blue-500 px-5 py-3 text-base font-medium text-white transition hover:bg-opacity-90">Log&nbsp;out</button>
          </div>
        </div>
      </div>
    </div>
  );
}
