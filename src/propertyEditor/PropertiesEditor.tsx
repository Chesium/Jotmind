import * as React from 'react';
import {View, StyleSheet} from 'react-native';
import {PropertyPairEditor} from './PropertyPairEditor';

export interface Properties {
  [Key: string]: string|undefined;
}

export type OnChangeProperty = (
  oldProp: Properties,
  newProp: Properties,
) => void;

export type OnSetPropertyKey = (oldKey: string, newKey: string) => void;

export type OnSetPropertyValue = (key: string, newValue: string) => void;

export function PropertiesEditor({
  properties,
  onChangeProperty,
  onSetPropertyKey,
  onSetPropertyValue,
}: {
  properties: Properties;
  onChangeProperty: OnChangeProperty;
  onSetPropertyKey: OnSetPropertyKey;
  onSetPropertyValue: OnSetPropertyValue;
}) {
  const [currentProp, setCurrentProp] = React.useState(properties);
  return (
    <View style={style.propertiesEditor}>
      {Object.keys(properties).map((k,i) => (
        <PropertyPairEditor
          key={`PropertyPairEditor-${i}`}
          properties={properties}
          keyname={k}
          onSetPropertyKey={(o, n) => {
            onSetPropertyKey(o, n);
            let tmpProp = currentProp;
            tmpProp[n] = tmpProp[o];
            delete tmpProp[o];
            onChangeProperty(currentProp,tmpProp);
            setCurrentProp(tmpProp);
          }}
          onSetPropertyValue={(k, v) => {
            onSetPropertyValue(k, v);
            let tmpProp = currentProp;
            tmpProp[k] = v;
            onChangeProperty(currentProp,tmpProp);
            setCurrentProp(tmpProp);
          }}></PropertyPairEditor>
      ))}
    </View>
  );
}

const style = StyleSheet.create({
  propertiesEditor: {
    alignItems: 'center',
  },
});
