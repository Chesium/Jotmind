import { Link, Outlet } from "react-router";
import { PiGraph, PiGraphDuotone } from 'react-icons/pi';
import { PiDatabase } from 'react-icons/pi';
import { PiUserCircle } from 'react-icons/pi';

export default function TabsLayout() {
  return (
    <div className="h-screen flex flex-col pb-[calc(85px+env(safe-area-inset-bottom))]">
      <div className="flex-1 scrollbar-none overflow-y-auto">
        <Outlet />
      </div>
      <div className="fixed bottom-0 inset-x-0 pb-[env(safe-area-inset-bottom)]">
        <div className="px-20 py-2 tabbar flex flex-row justify-between items-center tab-shadow bg-white">
          <Link to="/cardview">
            <div className="flex flex-col items-center">
            <PiDatabase size={30}></PiDatabase>
            <span className="text-sm">data</span>
            </div>
          </Link>
          <Link to="/graphview">
          <div className="flex flex-col items-center">
            <PiGraph size={30}></PiGraph>
            <span className="text-sm">graph</span>
          </div>
          </Link>
          <Link to="/dashboard">
            <div className="flex flex-col items-center">
              <PiUserCircle size={30}></PiUserCircle>
              <span className="text-sm">account</span>
            </div>
          </Link>
        </div>
        <div className="bg-sky-800 text-white text-xs flex flex-row justify-center">
          <span>status: normal</span>
        </div>
      </div>
    </div>
  );
}