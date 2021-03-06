import * as React from 'react';
import { DurationInSeconds, PollIntervalInMs } from '../../types/Common';
import { Button, MenuItem, Icon, DropdownButton } from 'patternfly-react';
import ToolbarDropdown from '../ToolbarDropdown/ToolbarDropdown';
import { config } from '../../config';
import { style } from 'typestyle';

//
// GraphRefresh actually handles the Duration dropdown, the RefreshInterval dropdown and the Refresh button.
//

type GraphRefreshProps = {
  id: string;
  handleRefresh: () => void;
  refreshIntervals: {
    [interval: number]: string;
  };
  disabled: boolean;
};

type ReduxProps = {
  duration: DurationInSeconds;
  pollInterval: PollIntervalInMs;

  onUpdatePollInterval: (selected: PollIntervalInMs) => void;
  onUpdateDuration: (duration: DurationInSeconds) => void;
};

const GraphRefresh: React.SFC<GraphRefreshProps & ReduxProps> = props => {
  const DURATION_LIST = config().toolbar.intervalDuration;

  const formatRefreshText = (key, isTitle: boolean = false): string => {
    // Ensure that we have an integer (for comparisons).
    key = Number(key);

    if (isTitle) {
      return key !== 0 ? `Every ${props.refreshIntervals[key]}` : 'Paused';
    } else {
      return key !== 0 ? `Every ${props.refreshIntervals[key]}` : props.refreshIntervals[key];
    }
  };

  const durationLabelStyle = style({
    paddingRight: '0.5em',
    marginLeft: '1.5em'
  });
  const refreshButtonStyle = style({
    paddingLeft: '0.5em'
  });

  return (
    <>
      <label className={durationLabelStyle}>Fetching</label>
      <ToolbarDropdown
        id={'graph_filter_duration'}
        disabled={props.disabled}
        handleSelect={props.onUpdateDuration}
        value={props.duration}
        label={String(DURATION_LIST[props.duration])}
        options={DURATION_LIST}
      />
      <DropdownButton
        id="graph_refresh_dropdown"
        title={formatRefreshText(props.pollInterval, true)}
        disabled={props.disabled}
      >
        {Object.keys(props.refreshIntervals).map((key: any) => {
          return (
            <MenuItem
              key={key}
              eventKey={key}
              active={Number(key) === props.pollInterval}
              onSelect={value => props.onUpdatePollInterval(Number(value))}
            >
              {formatRefreshText(key)}
            </MenuItem>
          );
        })}
      </DropdownButton>
      <span className={refreshButtonStyle}>
        <Button id="refresh_button" onClick={props.handleRefresh} disabled={props.disabled}>
          <Icon name="refresh" />
        </Button>
      </span>
    </>
  );
};

export default GraphRefresh;
