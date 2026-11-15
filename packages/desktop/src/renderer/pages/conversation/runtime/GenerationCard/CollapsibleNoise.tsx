/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Button } from '@arco-design/web-react';
import { Down, Right } from '@icon-park/react';

type CollapsibleNoiseProps = {
  /** One-line summary shown while collapsed, for example the tool step count. */
  label: string;
  /** Keeps the content open, for example while a tool is still running. */
  forceOpen?: boolean;
  children: React.ReactNode;
};

/** Collapses code-agent output (tool calls, file diffs) behind one line so generated media stays the focus. */
const CollapsibleNoise: React.FC<CollapsibleNoiseProps> = ({ label, forceOpen = false, children }) => {
  const [open, setOpen] = useState(false);
  const expanded = forceOpen || open;
  return (
    <div data-testid='collapsible-noise'>
      <Button
        size='mini'
        type='text'
        aria-expanded={expanded}
        icon={expanded ? <Down size={12} /> : <Right size={12} />}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </Button>
      {expanded && <div className='mt-4px'>{children}</div>}
    </div>
  );
};

export default CollapsibleNoise;
