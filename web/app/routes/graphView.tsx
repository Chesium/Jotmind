import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import EntityCard from '~/components/EntityCard';
import { useEntities } from '~/store/useEntities';
import JotMindLogo from '../assets/jotmind_logo.svg?react';
import SearchBar from '~/components/SearchBar';
import { PiPlusBold } from 'react-icons/pi';
import { defaultEntity } from '@my-repo/shared-types';
import { ScaleLoader } from 'react-spinners';
import CytoGraph from '~/components/CytoGraph';
import { toCyto } from '~/lib/toCyto';

export default function CardView() {
  const {
    displayedIdx,
    initialized,
    fetchAll,
    updateEntity,
    entitiesMap,
    claimsMap,
  } = useEntities();
  const nav = useNavigate();

  useEffect(() => {
    if (!initialized) {
      fetchAll();
    }
  }, [initialized, fetchAll]);

  const newEntity = () => {
    const newEntity = defaultEntity();
    updateEntity(
      {
        entity: newEntity,
        claims: [],
      },
      false
    );
    nav(`/entity/${newEntity.uuid}/edit`);
  };

  return (
    <div className="relative bg-white text-center sm:px-12 md:px-[60px]">
      <div className="fixed top-0 inset-x-0 p-2 bg-white topbar-shadow flex gap-3 flex-col">
        <div className="flex gap-3 flex-row items-center">
          <JotMindLogo width={40} />
          <span className="text-xl">Card View</span>
        </div>
        <div className="flex gap-2 flex-row items-center">
          <button
            onClick={newEntity}
            className="bg-black text-white text-2xl p-2 rounded-md"
          >
            <PiPlusBold />
          </button>
          <SearchBar></SearchBar>
        </div>
      </div>
      {initialized ? (
        <CytoGraph
          onClick={(uuid) => {
            if (uuid in entitiesMap) {
              nav(`/entity/${uuid}`);
            }
          }}
          elements={toCyto(entitiesMap, claimsMap)}
        ></CytoGraph>
      ) : (
        <div className="flex flex-col w-full gap-5 pt-[calc(70px+env(safe-area-inset-bottom))]">
          <div className="flex flex-col items-center gap-5">
            <ScaleLoader></ScaleLoader>
            <span>fetching data from database...</span>
          </div>
        </div>
      )}
    </div>
  );
}
