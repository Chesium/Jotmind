import type { IconBaseProps } from 'react-icons/lib';
import { PiPlaceholder, PiAtom, PiGpsFix, PiPersonSimpleCircle, PiCalendarStar } from 'react-icons/pi';

interface Prop extends IconBaseProps {
  label: string
}

export default function EntityIcon(prop: Prop) {
  switch (prop.label) {
    case "Person":
      return <PiPersonSimpleCircle {...prop} />
    case "Place":
      return <PiGpsFix {...prop} />
    case "Event":
      return <PiCalendarStar {...prop} />
    case "Concept":
      return <PiAtom {...prop} />
    default:
      return <PiPlaceholder {...prop} />
  }
}