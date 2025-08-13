import { Navigate, useNavigate } from "react-router";
import { api, authClient } from "../lib/auth-client";
import { BarLoader, ScaleLoader } from "react-spinners";
import { useEntities } from "~/store/useEntities";
import { useState } from "react";

export default function Dashboard() {
  const { initialized, setRefresh } = useEntities();

  const nav = useNavigate();
  // auto-refreshes when user logs in/out thanks to useSession
  const sessionRaw = authClient.useSession(); // hook from docs
  const { data: session, isPending } = sessionRaw;

  const [diaplayHButton, setDiaplayHButton] = useState<boolean>((session as any)?.initialized ?? false);
  const [waiting, setWaiting] = useState<boolean>(false);
  const [hcomplete, setHcomplete] = useState<boolean>(false);


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

  async function loadTestData() {
    setWaiting(true);
    await api<null, null>("/hydratetest");
    setDiaplayHButton(false);
    setWaiting(false);
    setHcomplete(true);
    setRefresh();
  }

  return (

    <div className="container mx-auto">
      <div className="-mx-4 flex flex-wrap">
        <div className="w-full px-4">
          <div className="relative mx-auto max-w-[525px] overflow-hidden rounded-lg bg-white px-10 py-16 text-center sm:px-12 md:px-[60px]">

            {isPending ? <div className="flex flex-col items-center gap-5">
              <ScaleLoader></ScaleLoader>
              <span>loading...</span>
            </div> : (session ? <>
              <h2>Hello, {session.user.name}</h2>
              <p>Your email: {session.user.email}</p>
              <p>session.Neo4jDb: {(session as any).neo4jDb}</p>
              <p>session.initialized: {(session as any).initialized}</p>

              {diaplayHButton ? "" : <button onClick={loadTestData} className="w-full cursor-pointer rounded-md border border-red-500 bg-red-500 px-5 py-3 text-base font-medium text-white transition hover:bg-opacity-90">Load&nbsp;Test&nbsp;Data</button>}

              {waiting ? <div className="flex flex-row justify-between items-center w-full">
                <BarLoader></BarLoader>
                <span>Hydrating Test Data...</span>
              </div> : ""}

              {hcomplete ? <div className="flex flex-row justify-between items-center w-full text-green-500">
                <span>Hydrating Done.</span>
              </div> : ""}

              <button onClick={logOut} className="w-full cursor-pointer rounded-md border border-blue-500 bg-blue-500 px-5 py-3 text-base font-medium text-white transition hover:bg-opacity-90">Log&nbsp;out</button>
            </> : <Navigate to="/login" />)}

          </div>
        </div>
      </div>
    </div>
  );
}
